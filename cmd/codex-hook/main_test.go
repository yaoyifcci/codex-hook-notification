package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSendAndRetry(t *testing.T) {
	var got []Event
	n := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("bad auth")
		}
		var ev Event
		json.NewDecoder(r.Body).Decode(&ev)
		got = append(got, ev)
		n++
		if n == 1 {
			w.WriteHeader(500)
		}
	}))
	defer srv.Close()
	e, err := makeEvent(Input{Event: "Stop", Session: "s", Cwd: "/repo"}, "host")
	if err != nil {
		t.Fatal(err)
	}
	if err = send(Config{URL: srv.URL, Key: "test-key"}, e); err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].ID != got[1].ID {
		t.Fatal("retry changed event id")
	}
}
func TestNoRetryForUnauthorized(t *testing.T) {
	n := 0
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { n++; w.WriteHeader(401) }))
	defer s.Close()
	if send(Config{URL: s.URL, Key: "bad"}, Event{}) == nil || n != 1 {
		t.Fatal("expected one rejected request")
	}
}
func TestTimeout(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { time.Sleep(1200 * time.Millisecond) }))
	defer s.Close()
	start := time.Now()
	if send(Config{URL: s.URL, Key: "x"}, Event{}) == nil {
		t.Fatal("expected timeout")
	}
	if time.Since(start) > 3*time.Second {
		t.Fatal("took too long")
	}
}
func TestReadConfig(t *testing.T) {
	p := filepath.Join(t.TempDir(), "config.json")
	os.WriteFile(p, []byte(`{"url":"http://127.0.0.1:1234","key":"test","source":"linux"}`), 0600)
	if _, e := readConfig(p); e != nil {
		t.Fatal(e)
	}
	os.WriteFile(p, []byte(`{"url":"https://example.com","key":"test"}`), 0600)
	if _, e := readConfig(p); e == nil {
		t.Fatal("expected invalid URL")
	}
}

func TestMessagePreview(t *testing.T) {
	e, err := makeEvent(Input{Event: "Stop", Message: "  已完成\n测试  "}, "host")
	if err != nil || e.Preview != "已完成 测试" {
		t.Fatalf("unexpected preview: %q %v", e.Preview, err)
	}
	e, _ = makeEvent(Input{Event: "PermissionRequest", Message: "not a reply"}, "host")
	if e.Preview != "" {
		t.Fatal("unexpected preview for other event")
	}
	e, _ = makeEvent(Input{Event: "Stop", Message: strings.Repeat("😀", 220)}, "host")
	if len([]rune(e.Preview)) != 200 {
		t.Fatal("preview must respect Unicode character limit")
	}
}

func TestToolDetails(t *testing.T) {
	raw := []byte(`{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"ls"},"tool_response":{"exit_code":0,"output":"ok"}}`)
	var in Input
	if err := json.Unmarshal(raw, &in); err != nil {
		t.Fatal(err)
	}
	e, _ := makeEvent(in, "host")
	if e.Tool != "Bash" || e.ToolInput != `{"command":"ls"}` || e.ToolResponse != `{"exit_code":0,"output":"ok"}` {
		t.Fatalf("bad event: %+v", e)
	}
	in.Event = "PreToolUse"
	e, _ = makeEvent(in, "host")
	if e.ToolInput == "" || e.ToolResponse != "" {
		t.Fatal("pre event leaked result")
	}
	if jsonPreview(json.RawMessage(`"hello"`), 100) != "hello" {
		t.Fatal("string output not decoded")
	}
	b, _ := json.Marshal(strings.Repeat("😀", 3000))
	p := jsonPreview(b, 2000)
	if len([]rune(p)) != 2000 || !strings.HasSuffix(p, "…") {
		t.Fatal("invalid truncation")
	}
}
