'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {formatCode}=require('../desktop/code-view');
test('formats nested JSON and highlights all JSON value types',()=>{
 const result=formatCode('{"output":{"text":"你好\\nworld","ok":true,"code":-1.5e2,"missing":null},"items":[1,2]}');
 assert.equal(result.language,'JSON');
 assert.equal(result.text,JSON.stringify(JSON.parse(result.text),null,2));
 assert.equal(result.tokens.map(t=>t.text).join(''),result.text);
 for(const type of ['key','string','number','boolean','null','punctuation'])assert.ok(result.tokens.some(t=>t.type===type),type);
});
test('plain and truncated results preserve their original content',()=>{
 for(const text of ['command completed\nexit code: 0','{"output":"截断…','', 'undefined']){
  const result=formatCode(text);assert.equal(result.language,'TEXT');assert.equal(result.text,text);assert.deepEqual(result.tokens,[{text,type:''}]);
 }
});
test('untrusted HTML remains token text and Unicode and escapes survive',()=>{
 const text=JSON.stringify({'<script>':'<img src=x onerror=alert(1)>','emoji':'😀','escape':'a"b\\c'});
 const result=formatCode(text);assert.equal(result.tokens.map(t=>t.text).join(''),result.text);assert.deepEqual(JSON.parse(result.text),JSON.parse(text));
});
