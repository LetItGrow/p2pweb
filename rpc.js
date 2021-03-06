
var kad = require('kademlia-dht');
var dns = require('dns');
var util = require('util');
var events = require('events');
var UTPMsg = require('./utp_msg');

var EventEmitter = events.EventEmitter;

function RPC(getObject){
  this._utpServer = null;
  this._handlers = {};
  this._utpConnections = {};
  if(getObject) this._getObject = getObject;
}

RPC._debugc = function(msg){
  console.log("RPC: " + msg);
}

RPC._debugs = function(msg){
  console.log("RPC: " + msg);
}

util.inherits(RPC, events.EventEmitter);

RPC.prototype._getObject = function(fid, cb) {
  // FIXME: use event
  cb(Error("RPC._getObject not implemented"));
};

RPC.prototype.setUTP = function(utpServer) {
  var self = this;
  this._utpServer = utpServer;

  utpServer.connectionOptions = {
    objectMode: true
  };

  utpServer.on('connection', function(connection){
    
    var endpoint = RPC._makeURL({
      protocol: "utp+p2pws",
      host: connection.host,
      port: connection.port
    });
    
    var request = [];
    
    connection.on('data', function(data){
      if(!data.meta) return request.push(data);
      var meta = data.meta.toString();

      if(meta == "flush-request") {
        handleRequest(function(response){
          if(response instanceof Buffer) {
            connection.write(response);
          } else if (response === undefined) {
            var flush_response = new Buffer();
            flush_response.meta = "flush-response";
            connection.write(flush_response);
          } else {
            connection.write(JSON.stringify(response));
            var flush_response = new Buffer();
            flush_response.meta = "flush-response";
            connection.write(flush_response);
          }
        });
      }
    });
    
    connection.on('end', function(){
      handleRequest(function(response){
        if(response instanceof Buffer) {
          connection.write(response);
        } else if (response === undefined) {
          connection.end();
        } else {
          connection.end(JSON.stringify(response));
        }
      });
    });
    
    function handleRequest(reply){
      var requestBuf = Buffer.concat(request);
      var requestObj;
      request = [];
      try {
        requestObj = JSON.parse(requestBuf.toString(), kad.JSONReviver);
      } catch(e) {
        console.error("RPC: Received request, parse error: " + e.toString());
        console.error(requestBuf.toString());
        return reply({error: "Request Parse Error: " + e.toString()});
      }
      
      RPC._debugs("Receive Request: " + endpoint + "/" + requestObj.request);
      
      if(requestObj.request == 'kademlia') {
        RPC._debugs("Receive Request: " + endpoint + "/" + requestObj.request + "/" + requestObj.type + ": " + JSON.stringify(requestObj.data));
        var response = {ok: self._handleKadMessage(requestObj.type, endpoint, requestObj.data)};
        RPC._debugs("Send Response: " + endpoint + "/" + requestObj.request + "/" + requestObj.type + ": " + JSON.stringify(response.ok));
        return reply(response);
      }

      if(requestObj.request == 'object') {
        RPC._debugs("Receive Request: " + endpoint + "/" + requestObj.request + "/" + requestObj.fid + ".");
        self._getObject(requestObj.fid, function(buf){
          if(!buf) return reply();
          RPC._debugs("Send Response: " + endpoint + "/" + requestObj.request + "/" + requestObj.fid + ": " + buf.length);
          reply(buf);
        });
        return;
      }
        
      if(requestObj.request == 'newRevision') {
        self.emit('new-revision', endpoint, requestObj.id, requestObj.rev, requestObj.revList);
        return reply({ok: "thank you"});
      }

      if(requestObj.request == 'publicURL') {
        RPC._debugs("Receive Request: " + endpoint + "/" + requestObj.request + ": respond " + endpoint);
        return reply({ok: endpoint});
      }

      reply({error: "Unknown request: " + requestBuf});
    }
  });
};

RPC.prototype._handleKadMessage = function(type, endpoint, data) {
  //console.log("RPC: receive " + type + " from " + endpoint);
  var handler = this._handlers[type];
  if(!handler) return null;
  return handler(endpoint, data);
};

RPC._parseAddress = function(endpoint) {
  var cap = /^([a-z0-9+-]+):\/\/([^:\/]+|\[[^\]+]\]+)(:([0-9]+))?(\/.*)?$/.exec(endpoint);
  if(!cap) return false;
  return {
    protocol: cap[1],
    host: cap[2],
    port: cap[4] ? parseInt(cap[4]) :
          cap[1] == "http"  ? 80 :
          cap[1] == "https" ? 443 :
          cap[1] == "ws"    ? 80 :
          cap[1] == "wss"   ? 443 :
          null,
    path: cap[5] || ""
  };
};

RPC.normalize = function(endpoint, callback) {
  if(!endpoint) return callback(null, endpoint);
  var elems = RPC._parseAddress(endpoint);
  dns.lookup(elems.host || '127.0.0.1', function(err, addr, family){
		if(err) return callback(err);
		elems.host = addr;
		return callback(null, RPC._makeURL(elems));
	});
}

RPC._makeURL = function(address) {
  var host = address.host.indexOf(':') == -1 ? address.host : "[" + address.host + "]";
  var port = address.port ? ":" + address.port : "";
  var path = address.path || "";
  return address.protocol + "://" + host + port + path;
};

RPC.prototype._connect = function(endpoint, data, timeout, callback) {
  var self = this;
  var addr = RPC._parseAddress(endpoint);
  if(addr.protocol == "utp+p2pws") {
    var opts = {
      data:       data,
      timeout:    timeout && timeout * 1000,
      objectMode: true
    };
    this._utpServer.connect(addr.port, addr.host, opts, function(err, conn) {
      return callback(err, conn, addr);
    });
  } else {
    return callback(new Error("Unknown protocol " + addr.protocol + " in " + endpoint), null, addr);
  }
};

RPC.prototype._sendKad = function(type, endpoint, data, callback) {
  var request = {
    request: 'kademlia',
    type: type,
    data: data
  };
  
  return this.request(endpoint, request, 30, callback);
};

RPC.prototype.requestStream = function(endpoint, request, timeout, callback) {
  if(typeof endpoint != 'string') throw new Error("Invalid endpoint " + endpoint);
  if(typeof timeout == 'function') {
    callback = timeout;
    timeout = undefined;
  }
  
  var self = this;
  var requestURL = endpoint + "/" + request.request;
  requestURL +=
    (request.request == "kademlia") ? ("/" + request.type) :
    (request.request == "object")   ? ("/" + request.fid)  :
    "";
  
  if(request.request != "publicURL")
    RPC._debugc("Send Request: " + requestURL + ": " + JSON.stringify(request.data));
  
  this._connect(endpoint, JSON.stringify(request), timeout, function(err, utp, addr){
    if(err) {
      console.log("RPC: Could not connect to " + endpoint + ": " + err.toString());
      return callback(err);
    }
    utp.once('connect', function(){
      if(callback(null, utp, addr, requestURL) !== false) utp.end();
    });
    utp.once('timeout', function(){
      var e = new Error('timeout');
      e.timeout = true;
      callback(e);
      self.emit('timeout', endpoint);
    });
  });
}

RPC.prototype.request = function(endpoint, request, timeout, callback) {
  if(typeof timeout == 'function') {
    callback = timeout;
    timeout = undefined;
  }
  this.requestStream(endpoint, request, timeout, function(err, utp, addr, requestURL){
    if(err) {
      console.log("RPC: Could not connect to " + endpoint + ": " + err.toString());
      return callback(err);
    }
    
    var response = [];
    
    utp.on('data', function(resdata){
      response.push(resdata);
    });
    
    utp.on('end', function(){
      var resBuffer = Buffer.concat(response);
      
      if(response.length == 0) {
        // The other end might be disconnected, not receiving any data
        console.error("RPC: Did not received any response for " + requestURL);
        return callback(new Error("No response"));
      }
  
      try {
        response = JSON.parse(resBuffer.toString(), kad.JSONReviver);
      } catch(e) {
        console.error("RPC: Cannot parse response for " + requestURL + ": " + e);
        console.error("RPC: Received " + resBuffer.length + " bytes: " + resBuffer.toString());
        return callback(new Error("Invalid response: " + e));
      }
      
      if(response && response.error) {
        console.error("RPC: error response: " + response.error);
        return callback(new Error("Remote error: " + response.error));
      }

      if(!response || !response.ok){
        var e = "RPC: no response for " + requestURL + " in " + JSON.stringify(response);
        console.error(e);
        return callback(new Error(e));
      }
      
      if(request.request != "publicURL")
        RPC._debugc("Receive Response: " + requestURL + ": " + JSON.stringify(response.ok));
      
      callback(null, response.ok);
    });
  });
};

RPC.prototype.getPublicURL = function(endpoint, timeout, cb) {
  return this.request(endpoint, {request: "publicURL"}, timeout, cb);
};

RPC.prototype.getObjectStream = function(endpoint, fid, timeout, cb) {
  if(typeof timeout == 'function') {
    cb = timeout;
    timeout = undefined;
  }
  return this.requestStream(endpoint, {request: "object", fid: fid}, timeout, function(err, stream){
    if(err) return cb(err.error);
    
    ReadHeaderSize();
    
    function ReadHeaderSize(){
      var size = stream.read(4);
      if(!size) return stream.once('readable', ReadHeaderSize);
      if(size.length < 4) throw new Error("Internal Error " + size.toString());
      if(size.length > 4) stream.unshift(size.slice(4));
      return ReadHeader(size.readInt32BE(0));
    }

    function ReadHeader(size){
      var header = stream.read(size);
      if(!header) return stream.once('readable', ReadHeader.bind(this, size));
      if(header.length > size) stream.unshift(header.slice(size));
      var meta = JSON.parse(header.slice(0, size).toString());
      
      if(!meta.ok) return cb(meta.error);
      
      return cb(meta.error, stream, meta.ok);
    }
  });
};

RPC.prototype.notifyNewRevision = function(endpoint, siteid, revision, revisionList, cb){
  return this.request(endpoint, {request: "newRevision", id: siteid, rev: revision, revList: revisionList}, cb);
};

RPC.prototype.ping = function(addr, data, cb) { return this._sendKad('ping', addr, data, cb); };
RPC.prototype.store = function(addr, data, cb) { return this._sendKad('store', addr, data, cb); };
RPC.prototype.findNode = function(addr, data, cb) { return this._sendKad('findNode', addr, data, cb); };
RPC.prototype.findValue = function(addr, data, cb) { return this._sendKad('findValue', addr, data, cb); };

RPC.prototype.receive = function(message, handler) {
  this._handlers[message] = handler;
};

RPC.prototype.close = function(){
  this._handlers = {};
};

module.exports = RPC;

