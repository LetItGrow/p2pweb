//
// Copyright (C) 2013,14 Torben Haase, Flowy Apps (torben@flowyapps.com)
// Copyright (C) 2014 Mildred Ki'Lya (mildred-spam@mildred.fr)
//
// r.js is free software: you can redistribute it and/or modify it under the
// terms of the GNU Lesser General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version.
//
// r.js is distributed in the hope that it will be useful, but WITHOUT ANY
// WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR
// A PARTICULAR PURPOSE.  See the GNU Lesser General Public License for more
// details.You should have received a copy of the GNU Lesser General Public
// License along with Smoothie.  If not, see <http://www.gnu.org/licenses/>.
//
// r.js is derived from the require script in Smoothie, developped by
// Torben Haase, Flowy Apps
//
////////////////////////////////////////////////////////////////////////////////

'use strict';

var $require = (function(){

function RequireError(message, fileName, lineNumber) {
	this.name = "RequireError";
	this.message = message;
}
RequireError.prototype = Object.create(Error.prototype);

var uid = (function(){var i=0; return function(){return i++;}})();
var cache = {};
var locks = {};
var callbacks = [];

var already_loaded = true;
if(window) {
  already_loaded = false
  window.addEventListener('load', function(){
    already_loaded = true;
    window.loaded = true;
  });
}

var scripts = document.getElementsByTagName("script");
for(var i = 0; i < scripts.length; i++) {
  if(!scripts[i].hasAttribute("data-main")) continue;
  var main = scripts[i].getAttribute("data-main");
  require_async_single(main);
}

var req = require.bind(this, "");
req.async = require_async.bind(this, "");
req.resolve = resolve;
return req;

function require(context, mod) {
  if(mod instanceof Array) {
    console.trace("Unsuppored use of require");
    throw new RequireError("Unsupported require([])");
  }
  var mod = resolve(context, mod);
  var cacheid = to_cacheid(mod);
  if(cache[cacheid] !== undefined && cache[cacheid].exports !== undefined) {
    return cache[cacheid].exports;
  } else {
    throw new RequireError("Module " + mod + " is not preloaded.");
  }
}

function require_async(context) {
  var mods = [];
  for(var i = 1; i < arguments.length; i++) {
    if(typeof arguments[i] == 'string') {
      var m = resolve(context, arguments[i]);
      mods.push(m);
      require_async_single(m)
    } else {
      callbacks.push({
        mods: mods,
        func: arguments[i]
      });
    }
  }
}

function resolve(context, mod) {
  if(!/^\.\//.test(mod)) return mod;
  var c = "/" + context;
  var c = c.replace(/\/[^\/]+$/g, "");
  var m = null, m2 = c + "/" + mod;
  while(m2 != m) {
    m = m2;
    m2 = m2.replace(/\/+/g, "/");
    m2 = m2.replace(/\/[^\/]+\/\.\.\//g, "/");
    m2 = m2.replace(/\/.\//g, "/");
  }
  m = m.replace(/^\//, "");
  return m;
}

function to_cacheid(mod) {
  return "$" + to_url(mod);
}

function to_url(mod) {
  return mod.replace(/(\/|\.js)?$/, "") + ".js";
}

function require_async_single(mod) {
  var cacheid = to_cacheid(mod);
  if(cache[cacheid] !== undefined) return;
  cache[cacheid] = {}
  
  if(typeof(module) !== "undefined" && typeof(module.require) !== "undefined") {
    // NodeJS, use the synchronious require anyway
    cache[cacheid].exports = module.require(mod);
  } else {
    var url = to_url(mod);
    //console.log("Loading module " + mod + " from: " + url);
    get_script(mod, url, cacheid, load_script.bind(this, mod, url, cacheid));
  }
}

function get_script(mod, url, cacheid, callback){
  var request = new XMLHttpRequest();
  
  // NOTE IE8 doesn't support the onload event, therefore we use
  //      onreadystatechange as a fallback here. However, onreadystatechange
  //      shouldn't be used for all browsers, since at least mobile Safari
  //      seems to have an issue where onreadystatechange is called twice for
  //      readyState 4.
  if(callback) request[request.onload===null?'onload':'onreadystatechange'] = onLoad;
  request.open('GET', url, !!callback);
  // NOTE Sending the request causes the event loop to continue. Therefore
  //      pending AJAX load events for the same url might be executed before
  //      the synchronous onLoad is called. This should be no problem, but in
  //      Chrome the responseText of the sneaked in load events will be empty.
  //      Therefore we have to lock the loading while executong send().   
  locks[cacheid] = locks[cacheid]++||1;
  request.send();
  locks[cacheid]--;
  if(!callback) return onLoad();

  function onLoad() {
    if (request.readyState != 4) {
      return;
    } else if (request.status != 200) {
      throw new RequireError('unable to load '+mod+" ("+request.status+" "+request.statusText+")");
    } else if (locks[cacheid]) {
      console.warn("require.js: module locked: "+mod);
      callback && setTimeout(onLoad, 0);
      return;
    } else {
      if(callback)
        callback(request.responseText);
      else
        return request.responseText;
    }
  }
}

function load_script(mod, url, cacheid, script) {
  cache[cacheid].code = script;
  var header = extract_header(script);
  try {
    var headerFunc = new Function('require', header);
  } catch(e) {
    console.error("Error " + e + " loading code:");
    console.error(header);
    throw e;
  }
  var dependentMods = [];
  //console.log("Extracting dependencies for module " + mod + ": " + header);
  try {
    headerFunc(function(m){
      var m2 = resolve(mod, m);
      require_async_single(m2);
      dependentMods.push(m2);
      //console.log("require: " + mod + " depends on " + m);
      return {};
    });
  } catch(e) {
    console.error("Error " + e + " executing code:");
    console.error(header);
    throw e;
  }
  cache[cacheid].depends = dependentMods;
  
  var module = {
    exports: {},
    require: require.bind(this, mod)
  };
  module.require.async  = require_async.bind(this, mod);
  module.require.onload = register_load_handler;
  
  Object.defineProperty(module, 'loaded', {
    get:function(){
      return cache[cacheid].loaded;
    },
    set:function(loaded){
      if(cache[cacheid].loaded !== undefined && cache[cacheid].loaded !== false) {
        throw new RequireError("Cannor unload module " + mod);
      }
      cache[cacheid].loaded = loaded;
      if(loaded) {
        setTimeout(execute_callbacks, 0);
      }
    }
  });

  var id;
  while(id === undefined || window[id] !== undefined) {
    id = "require_" + mod + "_" + uid();
  }
  window[id] = code_ready;

  if(dependentMods.length > 0) {
    console.log("r.js: Module " + url + " depends on: " + dependentMods.join(", "));
    callbacks.push({
      mods: dependentMods,
      func: deps_ready
    });
  } else {
    //console.log("r.js: Module " + mod + " depends on: " + dependentMods.join(", "));
    deps_ready();
  }
  
  function deps_ready(){
    add_code('window[' + JSON.stringify(id) + '](function(global, module, exports, require){if(true){' + script + '\n} return {m:module, e:exports}; });\n//# sourceURL='+url);
  }
  
  function code_ready(f){
    console.log("r.js: Execute module " + url);
    delete window[id];
    f.apply(module.exports, [window, module, module.exports, module.require]);
    cache[cacheid].exports = module.exports
    if(cache[cacheid].loaded === undefined) {
      cache[cacheid].loaded = true
      execute_callbacks();
    }
  }
}

function execute_callbacks(){
  for(var i = 0; i < callbacks.length; i++) {
    var cb = callbacks[i];
    if(!cb) continue;
    var loaded = true;
    for(var j = 0; j < cb.mods.length && loaded; j++) {
      var cacheid = to_cacheid(cb.mods[j]);
      loaded = !!cache[cacheid].loaded;
    }
    if(loaded) {
      callbacks[i].func();
      callbacks[i] = null;
    }
  }
}

function extract_header(s) {
  var ws = /([\s\n]+|\/\/[^\n]*|\/\*.*?\*\/)+/.source;
  var req = /require\([^\(\)]+\)(\s?\.\s?\S*|\s?\[[^\[\]]*\])?/.source;
  var header = /^(\s?((var\s)?\S+\s?=\s?)?require(\s?,\s?\S+\s?=\s?require)*\s?;)+/.source;
  header = new RegExp(header.replace(/require/g, "(" + req + ")").replace(/\\s/g, "(" + ws + ")"));
  var cap = header.exec(s);
  if(cap) return cap[0];
}

function add_code(js, content_type){
  var e = document.createElement('script');
  e.type = content_type || 'text/javascript';
  e.src  = 'data:' + e.type + ','+escape(js);
  document.head.appendChild(e);
}

function register_load_handler(fun) {
  window.addEventListener('load', fun);
  if(already_loaded) setTimeout(fun, 0);
}

})();

if(typeof window !== 'undefined') {
  if(typeof(window.$r) !== 'undefined') {
    throw new Error("window.$r already defined.");
  }
  window.$r = $require
  if(typeof(window.require) !== 'undefined') {
    window.require = $require;
  } else {
    console.error("window.require already defined");
  }
} else if(typeof(module) !== 'undefined') {
  module.exports = $require;
} else {
  throw new Error("Could not load require module.");
}
