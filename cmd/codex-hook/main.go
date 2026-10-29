package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Config struct {
	URL    string `json:"url"`
	Key    string `json:"key"`
	Source string `json:"source"`
}
type Input struct {
	Title        string          `json:"session_title"`
	ToolInput    json.RawMessage `json:"tool_input"`
	ToolResponse json.RawMessage `json:"tool_response"`
	Message      string          `json:"last_assistant_message"`
	Event        string          `json:"hook_event_name"`
	Session      string          `json:"session_id"`
	Cwd          string          `json:"cwd"`
	Turn         string          `json:"turn_id"`
	Tool         string          `json:"tool_name"`
}
type Event struct {
	Title        string `json:"session_title,omitempty"`
	ToolInput    string `json:"tool_input_preview,omitempty"`
	ToolResponse string `json:"tool_response_preview,omitempty"`
	Preview      string `json:"preview,omitempty"`
	Version      int    `json:"version"`
	ID           string `json:"id"`
	Time         string `json:"time"`
	Source       string `json:"source"`
	Event        string `json:"event"`
	Session      string `json:"session_id"`
	Cwd          string `json:"cwd"`
	Turn         string `json:"turn_id,omitempty"`
	Tool         string `json:"tool_name,omitempty"`
}

var events = []string{"SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "PreCompact", "PostCompact", "SubagentStart", "SubagentStop", "Stop", "Interrupt"}

func configPath() string {
	h, _ := os.UserHomeDir()
	return filepath.Join(h, ".config", "codex-hook", "config.json")
}
func readConfig(path string) (Config, error) {
	var c Config
	b, e := os.ReadFile(path)
	if e != nil {
		return c, e
	}
	if e = json.Unmarshal(b, &c); e != nil {
		return c, e
	}
	u, e := url.Parse(c.URL)
	if e != nil || u.Scheme != "http" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return c, errors.New("url must be an HTTP origin, e.g. http://192.168.1.2:19280")
	}
	if c.Key == "" || strings.ContainsAny(c.Key, "\r\n") {
		return c, errors.New("key is required")
	}
	if c.Source == "" {
		c.Source, _ = os.Hostname()
	}
	return c, nil
}
func clip(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}
func jsonPreview(raw json.RawMessage, limit int) string {
	if len(raw) == 0 {
		return ""
	}
	var text string
	if json.Unmarshal(raw, &text) != nil {
		var b bytes.Buffer
		if json.Compact(&b, raw) != nil {
			return ""
		}
		text = b.String()
	}
	text = strings.TrimSpace(text)
	if len([]rune(text)) > limit {
		return clip(text, limit-1) + "…"
	}
	return text
}

// The local index is best-effort metadata, not a stable hook API.
func sessionTitle(session string) string {
	if session == "" {
		return ""
	}
	dir := os.Getenv("CODEX_HOME")
	if dir == "" {
		h, _ := os.UserHomeDir()
		dir = filepath.Join(h, ".codex")
	}
	return titleFromIndex(filepath.Join(dir, "session_index.jsonl"), session)
}
func titleFromIndex(path, session string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() {
		return ""
	}
	offset := st.Size() - 4*1024*1024
	if offset < 0 {
		offset = 0
	}
	if _, err = f.Seek(offset, io.SeekStart); err != nil {
		return ""
	}
	b, err := io.ReadAll(io.LimitReader(f, 4*1024*1024))
	if err != nil {
		return ""
	}
	lines := bytes.Split(b, []byte("\n"))
	if offset > 0 && len(lines) > 0 {
		lines = lines[1:]
	}
	for i := len(lines) - 1; i >= 0; i-- {
		var row struct {
			ID   string `json:"id"`
			Name string `json:"thread_name"`
		}
		if json.Unmarshal(lines[i], &row) == nil && row.ID == session && strings.TrimSpace(row.Name) != "" {
			return clip(strings.Join(strings.Fields(row.Name), " "), 200)
		}
	}
	return ""
}
func makeEvent(in Input, source string) (Event, error) {
	if in.Event == "" {
		return Event{}, errors.New("hook_event_name is required")
	}
	id := make([]byte, 16)
	if _, err := rand.Read(id); err != nil {
		return Event{}, err
	}
	preview := ""
	if in.Event == "Stop" || in.Event == "SubagentStop" {
		preview = clip(strings.Join(strings.Fields(in.Message), " "), 200)
	}
	args, result := "", ""
	if in.Event == "PreToolUse" || in.Event == "PostToolUse" {
		args = jsonPreview(in.ToolInput, 1000)
	}
	if in.Event == "PostToolUse" {
		result = jsonPreview(in.ToolResponse, 2000)
	}
	title := clip(strings.Join(strings.Fields(in.Title), " "), 200)
	if title == "" {
		title = sessionTitle(in.Session)
	}
	return Event{title, args, result, preview, 1, hex.EncodeToString(id), time.Now().UTC().Format(time.RFC3339Nano), clip(source, 128), clip(in.Event, 128), clip(in.Session, 256), clip(in.Cwd, 1024), clip(in.Turn, 256), clip(in.Tool, 256)}, nil
}
func send(c Config, ev Event) error {
	body, e := json.Marshal(ev)
	if e != nil {
		return e
	}
	endpoint := strings.TrimRight(c.URL, "/") + "/v1/events"
	client := &http.Client{Timeout: time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	var last error
	deadline := time.Now().Add(3 * time.Second)
	for i := 0; i < 2 && time.Now().Before(deadline); i++ {
		req, e := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
		if e != nil {
			return e
		}
		req.Header.Set("Authorization", "Bearer "+c.Key)
		req.Header.Set("Content-Type", "application/json")
		resp, e := client.Do(req)
		if e != nil {
			last = e
			continue
		}
		io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		resp.Body.Close()
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return nil
		}
		last = fmt.Errorf("receiver returned HTTP %d", resp.StatusCode)
		if resp.StatusCode < 500 {
			return last
		}
	}
	return last
}
func logError(path string, err error) {
	dir := filepath.Dir(path)
	if os.MkdirAll(dir, 0700) != nil {
		return
	}
	p := filepath.Join(dir, "codex-hook.log")
	if st, e := os.Stat(p); e == nil && st.Size() > 256*1024 {
		_ = os.Remove(p)
	}
	f, e := os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if e == nil {
		defer f.Close()
		fmt.Fprintf(f, "%s %s\n", time.Now().Format(time.RFC3339), err)
	}
}
func hookConfig(config string) error {
	exe, e := os.Executable()
	if e != nil {
		return e
	} // shell quote the executable so spaces and quotes remain safe.
	command := "'" + strings.ReplaceAll(exe, "'", "'\\''") + "' send --config '" + strings.ReplaceAll(config, "'", "'\\''") + "'"
	h := map[string]any{}
	for _, name := range events {
		h[name] = []any{map[string]any{"hooks": []any{map[string]any{"type": "command", "command": command, "timeout": 3, "async": true}}}}
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(map[string]any{"hooks": h})
}
func run() int {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: codex-hook <send|test|hooks> [--config PATH]")
		return 2
	}
	cmd := os.Args[1]
	fs := flag.NewFlagSet(cmd, flag.ContinueOnError)
	path := fs.String("config", configPath(), "configuration path")
	if e := fs.Parse(os.Args[2:]); e != nil {
		if cmd == "send" {
			return 0
		}
		return 2
	}
	if cmd == "hooks" {
		if e := hookConfig(*path); e != nil {
			fmt.Fprintln(os.Stderr, e)
			return 1
		}
		return 0
	}
	if cmd != "send" && cmd != "test" {
		fmt.Fprintln(os.Stderr, "unknown command:", cmd)
		return 2
	}
	c, e := readConfig(*path)
	if e == nil {
		var in Input
		if cmd == "test" {
			in = Input{Event: "Test", Cwd: "test"}
		} else {
			b, err := io.ReadAll(io.LimitReader(os.Stdin, 1024*1024+1))
			if err != nil {
				e = err
			} else if len(b) > 1024*1024 {
				e = errors.New("hook input too large")
			} else {
				e = json.Unmarshal(b, &in)
			}
		}
		if e == nil {
			var ev Event
			ev, e = makeEvent(in, c.Source)
			if e == nil {
				e = send(c, ev)
			}
		}
	}
	if e != nil {
		if cmd == "send" {
			logError(*path, e)
			return 0
		}
		fmt.Fprintln(os.Stderr, "test failed:", e)
		return 1
	}
	if cmd == "test" {
		fmt.Println("notification accepted")
	}
	return 0
}
func main() { os.Exit(run()) }
