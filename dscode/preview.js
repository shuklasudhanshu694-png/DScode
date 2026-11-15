(function (root) {
  'use strict';
  var L = root.DSLang || (typeof require !== 'undefined' ? require('./lang.js') : null);
  var S = root.DSStore || (typeof require !== 'undefined' ? require('../shared/store.js') : null);
  var Lint = root.DSLint || (typeof require !== 'undefined' ? require('./lint.js') : null);

  var MAX_ASSET = 4 * 1024 * 1024, MAX_FETCH_MAP = 3 * 1024 * 1024;

  var BRIDGE = '(function(){\n' +
    'var P=window.parent,BASE=window.__DS_BASE||"",FILES=window.__DS_FILES||{},LS=window.__DS_LS||{};\n' +
    'function send(m){try{m.__ds=1;P.postMessage(m,"*");}catch(e){}}\n' +
    'function fmt(a,d){d=d||0;try{\n' +
    ' if(a instanceof Error)return a.stack||(a.name+": "+a.message);\n' +
    ' if(typeof a==="string")return a;if(typeof a==="function")return "[Function "+(a.name||"anonymous")+"]";\n' +
    ' if(a===undefined)return "undefined";if(a===null)return "null";if(typeof a==="symbol")return a.toString();\n' +
    ' if(a&&a.nodeType===1)return "<"+a.tagName.toLowerCase()+(a.id?"#"+a.id:"")+(a.className&&typeof a.className==="string"?"."+a.className.trim().split(/\\s+/).join("."):"")+">";\n' +
    ' if(typeof a==="object"){var seen=[];var s=JSON.stringify(a,function(k,v){if(typeof v==="function")return "[Function]";if(typeof v==="bigint")return v.toString()+"n";if(v&&typeof v==="object"){if(seen.indexOf(v)!==-1)return "[Circular]";seen.push(v);}return v;},d?0:2);return s&&s.length>3000?s.slice(0,3000)+"…":s;}\n' +
    ' return String(a);}catch(e){return "[unprintable]";}}\n' +
    '["log","info","warn","error","debug"].forEach(function(k){var o=console[k];console[k]=function(){send({type:"console",level:k,text:Array.prototype.map.call(arguments,function(x){return fmt(x);}).join(" ")});try{o.apply(console,arguments);}catch(e){}};});\n' +
    'var oc=console.clear;console.clear=function(){send({type:"clear"});try{oc.call(console);}catch(e){}};\n' +
    'var ot=console.table;console.table=function(d){send({type:"console",level:"log",text:fmt(d)});try{ot.apply(console,arguments);}catch(e){}};\n' +
    'window.addEventListener("error",function(ev){\n' +
    ' if(ev.target&&ev.target!==window&&(ev.target.src||ev.target.href)){send({type:"console",level:"error",text:"Failed to load resource: "+(ev.target.getAttribute("src")||ev.target.getAttribute("href"))});return;}\n' +
    ' send({type:"error",message:ev.message,line:ev.lineno,col:ev.colno,stack:ev.error&&ev.error.stack?String(ev.error.stack):""});},true);\n' +
    'window.addEventListener("unhandledrejection",function(ev){send({type:"error",message:"Unhandled promise rejection: "+fmt(ev.reason),line:0,col:0,stack:""});});\n' +
    'var storageOk=true;try{void window.localStorage.length;}catch(e){storageOk=false;}\n' +
    'if(!storageOk){\n' +
    ' var mk=function(data,persist){var api={getItem:function(k){return Object.prototype.hasOwnProperty.call(data,k)?data[k]:null;},setItem:function(k,v){data[String(k)]=String(v);if(persist)send({type:"ls",op:"set",key:String(k),val:String(v)});},removeItem:function(k){delete data[k];if(persist)send({type:"ls",op:"del",key:String(k)});},clear:function(){Object.keys(data).forEach(function(k){delete data[k];});if(persist)send({type:"ls",op:"clear"});},key:function(i){return Object.keys(data)[i]||null;}};\n' +
    '  Object.defineProperty(api,"length",{get:function(){return Object.keys(data).length;}});return api;};\n' +
    ' try{Object.defineProperty(window,"localStorage",{configurable:true,value:mk(LS,true)});Object.defineProperty(window,"sessionStorage",{configurable:true,value:mk({},false)});}catch(e){}\n' +
    '}\n' +
    'function resolve(u){if(/^(?:[a-z][a-z0-9+.-]*:|\\/\\/)/i.test(u))return null;var clean=String(u).split(/[?#]/)[0];var parts=clean.charAt(0)==="/"?[]:BASE.split("/").filter(Boolean);clean.replace(/^\\/+/,"").split("/").forEach(function(p){if(!p||p===".")return;if(p==="..")parts.pop();else parts.push(p);});return parts.join("/");}\n' +
    'var realFetch=window.fetch;\n' +
    'window.fetch=function(input,init){var url=typeof input==="string"?input:(input&&input.url)||"";var p=resolve(url);\n' +
    ' if(p!==null){if(Object.prototype.hasOwnProperty.call(FILES,p)){var type=/\\.json$/i.test(p)?"application/json":/\\.html?$/i.test(p)?"text/html":/\\.css$/i.test(p)?"text/css":/\\.js$/i.test(p)?"text/javascript":"text/plain";return Promise.resolve(new Response(FILES[p],{status:200,headers:{"Content-Type":type}}));}\n' +
    '  return Promise.resolve(new Response("File not found in DScode workspace: "+p,{status:404,statusText:"Not Found"}));}\n' +
    ' return realFetch.apply(this,arguments);};\n' +
    'var XO=XMLHttpRequest.prototype.open,XS=XMLHttpRequest.prototype.send;\n' +
    'XMLHttpRequest.prototype.open=function(m,u){this.__dsPath=resolve(String(u));return XO.apply(this,arguments);};\n' +
    'XMLHttpRequest.prototype.send=function(){var x=this,p=x.__dsPath;if(p!==null&&p!==undefined){var has=Object.prototype.hasOwnProperty.call(FILES,p);setTimeout(function(){Object.defineProperty(x,"status",{value:has?200:404});Object.defineProperty(x,"readyState",{value:4});Object.defineProperty(x,"responseText",{value:has?FILES[p]:""});Object.defineProperty(x,"response",{value:has?FILES[p]:""});if(x.onreadystatechange)x.onreadystatechange();var ev=new Event(has?"load":"error");if(x.onload&&has)x.onload(ev);if(x.onerror&&!has)x.onerror(ev);x.dispatchEvent(ev);},0);return;}return XS.apply(this,arguments);};\n' +
    'document.addEventListener("click",function(ev){var a=ev.target&&ev.target.closest?ev.target.closest("a[href]"):null;if(!a||ev.defaultPrevented)return;var h=a.getAttribute("href");if(!h||h.charAt(0)==="#"||a.target==="_blank"||a.hasAttribute("download"))return;var p=resolve(h);if(p!==null&&/\\.html?$/i.test(p)){ev.preventDefault();send({type:"nav",path:p});}else if(p===null&&/^(?:https?:)?\\/\\//i.test(h)){ev.preventDefault();send({type:"console",level:"info",text:"Blocked navigation inside preview: "+h+" (opens only in a new tab)"});}},true);\n' +
    'window.addEventListener("message",function(ev){if(ev.source!==P)return;var m=ev.data;if(!m||!m.__ds||m.type!=="eval")return;try{var r=(0,eval)(m.code);Promise.resolve(r).then(function(v){send({type:"evalresult",id:m.id,ok:true,value:fmt(v)});},function(e){send({type:"evalresult",id:m.id,ok:false,value:fmt(e)});});}catch(e){send({type:"evalresult",id:m.id,ok:false,value:fmt(e)});}});\n' +
    'send({type:"ready"});\n})();';

  function jsonForScript(obj) {
    return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }
  function escapeInlineScript(code) { return code.replace(/<\/(script)/gi, '<\\/$1'); }
  function escapeInlineStyle(code) { return code.replace(/<\/(style)/gi, '<\\/$1'); }
  function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  function isExternal(ref) { return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref); }

  function build(files, mainPath, opts) {
    opts = opts || {};
    var warnings = [], sourceMap = [], moduleCache = {};
    function file(p) { return files[p]; }
    function warnMissing(ref, from) { warnings.push('Not found in workspace: ' + ref + ' (referenced from ' + from + ')'); }
    function toDataUrl(p) {
      var f = file(p);
      if (!f) return null;
      var bytes = S.fileBytes(f);
      if (bytes.length > MAX_ASSET) { warnings.push('Skipped inlining ' + p + ' (' + Math.round(bytes.length / 1024) + ' KB is over the preview asset limit).'); return null; }
      return 'data:' + (f.mime || L.mimeOf(p)) + ';base64,' + S.bytesToB64(bytes);
    }

    function inlineCSS(css, from, depth) {
      depth = depth || 0;
      css = css.replace(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?\s*([^;]*);/gi, function (m, ref) {
        if (isExternal(ref) || depth > 5) return m;
        var p = Lint.resolveRef(ref, from);
        if (p && file(p)) return '/* inlined ' + p + ' */\n' + inlineCSS(file(p).content, p, depth + 1) + '\n';
        warnMissing(ref, from); return m;
      });
      return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, function (m, q, ref) {
        ref = ref.trim();
        if (isExternal(ref) || /^data:/i.test(ref)) return m;
        var p = Lint.resolveRef(ref, from);
        if (!p) return m;
        var du = toDataUrl(p);
        if (du) return 'url("' + du + '")';
        if (!file(p)) warnMissing(ref, from);
        return m;
      });
    }

    function rewriteModule(code, from, depth) {
      if (depth > 8) return code;
      return code.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])([^"']+)\2/g, function (m, pre, q, ref) {
        if (/^\s*(?:type|\{|\*)/.test(ref) || isExternal(ref) || !/^[./]/.test(ref)) return m;
        var p = Lint.resolveRef(ref, from);
        if (!p) return m;
        if (!file(p)) { warnMissing(ref, from); return m; }
        var du = moduleDataUrl(p, depth + 1);
        return du ? pre + q + du + q : m;
      });
    }
    function moduleDataUrl(p, depth) {
      if (moduleCache[p] !== undefined) return moduleCache[p];
      moduleCache[p] = null;
      var code = rewriteModule(file(p).content, p, depth);
      var url = 'data:text/javascript;base64,' + S.bytesToB64(S.utf8ToBytes(code));
      moduleCache[p] = url;
      return url;
    }

    var entry = file(mainPath);
    if (!entry) throw new Error('Preview entry not found: ' + mainPath);
    var code = entry.content || '';
    if (!/<html[\s>]/i.test(code) && !/<!doctype/i.test(code)) code = '<!DOCTYPE html>\n<html><head><meta charset="UTF-8"></head><body>\n' + code + '\n</body></html>';

    var nodes = L.parseHTML(code), repl = [];
    for (var i = 0; i < nodes.length; i++) {
      var nd = nodes[i];
      if (nd.type === 'open') {
        var attr = function (name) { for (var q = 0; q < nd.attrs.length; q++) if (nd.attrs[q].name === name) return nd.attrs[q]; return null; };
        if (nd.name === 'link') {
          var rel = attr('rel'), href = attr('href');
          if (href && href.value && !isExternal(href.value)) {
            var lp = Lint.resolveRef(href.value, mainPath);
            if (rel && /stylesheet/i.test(rel.value || '')) {
              if (lp && file(lp)) {
                repl.push({ s: nd.s, e: nd.e, text: '<style data-src="' + escAttr(lp) + '">\n' + escapeInlineStyle(inlineCSS(file(lp).content, lp, 0)) + '\n</style>', mapPath: lp });
              } else warnMissing(href.value, mainPath);
            } else if (lp && file(lp)) {
              var du = toDataUrl(lp); if (du) repl.push({ s: href.vs, e: href.ve, text: '"' + du + '"' });
            }
          }
        } else if (nd.name === 'script') {
          var src = attr('src'), type = attr('type');
          if (src && src.value && !isExternal(src.value)) {
            var sp = Lint.resolveRef(src.value, mainPath), endNode = nd.e, k = i + 1;
            if (nodes[k] && nodes[k].type === 'raw') { endNode = nodes[k].e; k++; }
            if (nodes[k] && nodes[k].type === 'close' && nodes[k].name === 'script') endNode = nodes[k].e;
            if (sp && file(sp)) {
              var isModule = type && /module/i.test(type.value || '');
              var body = isModule ? rewriteModule(file(sp).content, sp, 0) : file(sp).content;
              var attrsText = code.slice(nd.nameE, nd.e - 1).replace(/\s+src\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, '').replace(/\/$/, '');
              repl.push({ s: nd.s, e: endNode, text: '<script' + attrsText + ' data-src="' + escAttr(sp) + '">\n' + escapeInlineScript(body) + '\n</script>', mapPath: sp });
            } else warnMissing(src.value, mainPath);
          }
        } else if (/^(img|source|video|audio|embed|track)$/.test(nd.name)) {
          var sa = attr('src');
          if (sa && sa.value && !isExternal(sa.value)) {
            var ip = Lint.resolveRef(sa.value, mainPath);
            if (ip && file(ip)) { var idu = toDataUrl(ip); if (idu) repl.push({ s: sa.vs, e: sa.ve, text: '"' + idu + '"' }); }
            else warnMissing(sa.value, mainPath);
          }
          var ps = attr('poster');
          if (ps && ps.value && !isExternal(ps.value)) { var pp = Lint.resolveRef(ps.value, mainPath); var pdu = pp && file(pp) ? toDataUrl(pp) : null; if (pdu) repl.push({ s: ps.vs, e: ps.ve, text: '"' + pdu + '"' }); }
        }
        var st = attr('style');
        if (st && st.value && /url\(/i.test(st.value)) repl.push({ s: st.vs, e: st.ve, text: '"' + escAttr(inlineCSS(st.value.replace(/&quot;/g, '"'), mainPath, 0)) + '"' });
      } else if (nd.type === 'raw') {
        var lang = L.rawLang(nd), inner = code.slice(nd.s, nd.e);
        if (lang === 'css' && /url\(|@import/i.test(inner)) repl.push({ s: nd.s, e: nd.e, text: escapeInlineStyle(inlineCSS(inner, mainPath, 0)) });
        else if (lang === 'js' && nd.name === 'script') {
          var ty = ''; nd.attrs.forEach(function (a) { if (a.name === 'type') ty = (a.value || '').toLowerCase(); });
          if (ty === 'module' && /\bimport\b/.test(inner)) repl.push({ s: nd.s, e: nd.e, text: escapeInlineScript(rewriteModule(inner, mainPath, 0)) });
        }
      }
    }
    repl.sort(function (a, b) { return b.s - a.s; });
    var html = code;
    repl.forEach(function (r) { html = html.slice(0, r.s) + r.text + html.slice(r.e); });

    var fetchMap = {}, total = 0;
    Object.keys(files).forEach(function (p) {
      var f = files[p];
      if (f.binary || p === mainPath) return;
      if (/\.(json|txt|csv|md|xml|html?|css|js|svg|tsv|yml|yaml)$/i.test(p) && total + f.content.length < MAX_FETCH_MAP) { fetchMap[p] = f.content; total += f.content.length; }
    });
    var base = mainPath.split('/').slice(0, -1).join('/');
    var inject = '<script>window.__DS_BASE=' + jsonForScript(base) + ';window.__DS_FILES=' + jsonForScript(fetchMap) + ';window.__DS_LS=' + jsonForScript(opts.storage || {}) + ';</script>\n<script>\n' + BRIDGE + '\n</script>\n';
    var headMatch = /<head[^>]*>/i.exec(html);
    if (opts.noBridge) { /* standalone export: no bridge */ }
    else if (headMatch) html = html.slice(0, headMatch.index + headMatch[0].length) + '\n' + inject + html.slice(headMatch.index + headMatch[0].length);
    else html = inject + html;

    var re = /<(script|style)\b[^>]*\bdata-src="([^"]*)"[^>]*>/gi, m;
    while ((m = re.exec(html)) !== null) {
      var startLine = html.slice(0, m.index + m[0].length).split('\n').length;
      var closeIdx = html.indexOf('</' + m[1], m.index + m[0].length);
      var endLine = html.slice(0, closeIdx === -1 ? html.length : closeIdx).split('\n').length;
      sourceMap.push({ from: startLine + 1, to: endLine, path: m[2].replace(/&quot;/g, '"').replace(/&amp;/g, '&'), tagLine: startLine });
    }
    return { html: html, sourceMap: sourceMap, warnings: warnings, mainPath: mainPath };
  }

  function mapLine(sourceMap, line, mainPath) {
    for (var i = 0; i < sourceMap.length; i++) {
      var r = sourceMap[i];
      if (line >= r.from && line <= r.to) return { path: r.path, line: line - r.tagLine };
    }
    return { path: mainPath, line: line };
  }

  function pickEntry(files, preferred) {
    if (preferred && files[preferred] && /\.html?$/i.test(preferred)) return preferred;
    if (files['index.html']) return 'index.html';
    var htmls = Object.keys(files).filter(function (p) { return /\.html?$/i.test(p); }).sort(function (a, b) { return a.split('/').length - b.split('/').length || a.localeCompare(b); });
    var idx = htmls.filter(function (p) { return /(^|\/)index\.html?$/i.test(p); })[0];
    return idx || htmls[0] || null;
  }

  var api = { build: build, mapLine: mapLine, pickEntry: pickEntry, BRIDGE: BRIDGE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DSPreview = api;
})(typeof window !== 'undefined' ? window : globalThis);
