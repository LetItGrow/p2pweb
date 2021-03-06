
require('./blob/Blob');
require('./localStorage');
require('./loaded');
require('./ui/moments');

var keytools             = require('./keytools'),
    sign                 = require('./sign'),
    Router               = require('./router'),
    hash                 = require('./hash'),
    MetaHeaders          = require('./metaheaders');
var template             = require('./ui/template'),
    updateMenu           = require('./ui/menu'),
    updateSite           = require('./ui/site'),
    updateSitePageEditor = require('./ui/sitepage');
var localSiteList        = require('./model/localsitelist');

module.exports = function(api){

  //
  // Update UI
  //

  updateMenu(localSiteList.getList());

  //
  // SignedHeader
  //

  function saveSite(site, cb){
    //console.log(site);
    api.sendBlob(site.text, site.getFirstId(), site.mh, function(e, id){
      if(e) {
        console.error(e.statusCode + " " + e.statusMessage);
        alert("Error: could not save site to the server.\n" + e.statusCode + " " + e.statusMessage + "\n" + e.message);
        // FIXME: we shouldn't reload in case of error because we are loosing changes here
      } else {
        //console.log("PUT /obj/" + id + " ok");
        if(cb) cb();
      }
    });
  }
  
  function saveBlob(docid, doc, mh, callback){
    console.log("Save: " + doc);

    api.sendBlob(doc, docid, mh, function(e, id){
      if(e) {
        console.error(e.statusCode + " " + e.statusMessage);
        alert("Error: could not save to the server.\n" + e.statusCode + " " + e.statusMessage + "\n" + e.message);
      }
      callback(e, id);
    });
  }

  function getSiteWithUI(siteKey, callback){
    api.getBlobNoCache(siteKey, function(err, content, mh){
      if(err) {
        alert("Could not load site " + siteKey + ":\n" + err);
        return callback();
      }
      if(!content) {
        alert("Could not load site " + siteKey + ":\nit has disappeared");
        return callback();
      }
      if(!/^application\/vnd.p2pws(;.*)?$/.test(mh.getHeader("content-type"))) {
        alert("Blob " + siteKey + " is not a P2PWebSite: wrong content type");
        return callback();
      }
      var site = new SignedHeader(mh, hash.make(mh), sign.checksign);
      site.parseText(content, siteKey);
      
      localSiteList.updateSite(siteKey, site);
      updateMenu(localSiteList.getList());

      callback(site);
    });
  }

  var currentSite;

  //
  // Routing
  //

  var r = new Router();

  r.on("/site/open", function(){
    document.querySelectorAll("section.showhide").hide();
    var section = document.querySelector("section#section-open-website");
    section.show();
    var website_id = section.querySelector(".website input");
    var btn_ok     = section.querySelector(".btn-ok");
    
    btn_ok.addEventListener('click', Finish);

    localSiteList.getServerList(function(err, list){
      if(err) {
        return alert("Error getting site list from server:\n" + err.status + " " + err.statusText + "\n" + err.responseText);
      }
      template.open_website.list.push({
        sites: list
      });
    });

    function Finish(){
      r.go("#!/site/" + website_id.value);
    }
  });
  
  (function(){ // TODO: put that in a separate file
    var section = document.querySelector("section#section-new-website");
    var website_id = section.querySelector(".website input");
    var btn_save   = section.querySelector(".btn-save");
    var btn_open   = section.querySelector(".btn-open");
    var btn_generate = section.querySelector(".btn-generate");
    var btn_cont_ok  = section.querySelector(".btn-continue");
    var btn_cont_no  = section.querySelector(".btn-continue-no-save");
    var website_elem = section.querySelector(".website")
    var span_wid     = section.querySelector(".website span")
    var privkey_elem = section.querySelector(".privkey");
    var keylabel     = section.querySelector(".privkey span");
    var save_pkey_elem = section.querySelector(".save-privkey");
      
    var crypt;
    var site;
    var id;

    btn_open    .addEventListener('click', keytools.generate_file_opener(btn_open, OpenPrivateKey));      
    btn_generate.addEventListener('click', keytools.generate_private_crypt_handler(1024, GeneratePrivateKey));
    btn_save    .addEventListener('click', SavePrivateKey);
    btn_cont_ok .addEventListener('click', GoToSite);
    btn_cont_no .addEventListener('click', GoToSite);
    
    function Enter(){
      document.querySelectorAll("section.showhide").hide();
      section.show();

      website_elem.hide();
      save_pkey_elem.hide();
      btn_cont_ok.hide();
      btn_cont_no.hide();
    }
    
    function GeneratePrivateKey(txt, crypt){
      console.log(txt);
      keylabel.textContent = txt;
      privkey_elem.show();
      if(crypt) {
        KeyAvailable(crypt, true);
        btn_cont_no.show();
        btn_cont_ok.hide();
      }
    }
    
    function OpenPrivateKey(err, _, crypt){
      alert("open privkey");
      KeyAvailable(crypt, false);
      btn_cont_no.hide();
      btn_cont_ok.show();
    }

    function KeyAvailable(crypt_, generated){
      var mh = MetaHeaders.fromContentType("application/vnd.p2pws");
      crypt = crypt_;
      site = new SignedHeader(mh, hash.make(mh), sign.checksign);
      site.addHeader("Format", "P2P Website");
      site.addHeader("PublicKey", crypt.getKey().getPublicBaseKeyB64());
      site.addSignature(sign.sign(crypt));
      id = site.getFirstId();
      span_wid.textContent = id;
      website_elem.show();
      save_pkey_elem.show();
      saveSite(site, function(){
        if(!generated) GoToSite();
      });
    }
    
    function SavePrivateKey(){
      keytools.save_private_crypt_handler(crypt);
      btn_cont_no.hide();
      btn_cont_ok.show();
    }
    
    function GoToSite(){
      r.go("#!/site/" + id);
    }

    r.on("/site/new", Enter);
  })();

  r.on(/^\/site\/([0-9a-fA-F]+)$/, function(req){
    document.querySelectorAll("section.showhide").hide();
    var siteKey = req[1].toLowerCase();
    getSiteWithUI(siteKey, function(site){
      if(!site) return r.go("#!/");
      document.querySelectorAll("#section-website-page").hide();
      document.querySelectorAll("#section-website").show();
      updateSite(localSiteList, saveSite, null, site);
    });
  });
  
  function savePage(siteKey, path, docid, doc, mh){
    saveBlob(docid, doc, mh, function(e, id){
      if(!e) r.go("#!/site/" + siteKey + "/page" + path);
    });
  }

  r.on(/^\/site\/([0-9a-fA-F]+)\/newpage$/, function(req){
    document.querySelectorAll("section.showhide").hide();
    var siteKey = req[1].toLowerCase();
    getSiteWithUI(siteKey, function(site){
      if(!site) return r.go("#!/");
      document.querySelectorAll("#section-website").show();
      updateSite(localSiteList, saveSite, null, site);
      updateSitePageEditor(localSiteList, saveSite, savePage, null, site);
    });
  });

  r.on(/^\/site\/([0-9a-fA-F]+)\/page(\/.*)$/, function(req){
    document.querySelectorAll("section.showhide").hide();
    var siteKey = req[1].toLowerCase();
    var path = req[2];
    getSiteWithUI(siteKey, function(site){
      if(!site) return r.go("#!/");
      var pagemetadata = site.getFile(path);
      document.querySelectorAll("#section-website").show();
      document.querySelectorAll("#section-website-page").show();
      updateSite(localSiteList, saveSite, null, site);
      api.getBlobCache(pagemetadata.id, function(err, content){
        if(err || !content) {
          alert("Couldn't read page id " + pagemetadata.id + "\n" + err);
          return r.go("#!/");
        }
        updateSitePageEditor(localSiteList, saveSite, savePage, null, site, {
          url:  path,
          body: content
        });
      });
    });
  });

  r.on("/status", function(req){
    document.querySelectorAll("section.showhide").hide();
    document.querySelectorAll("#section-status").show();
  });

  r.on(/^\/status\/seed\/([0-9a-fA-F]+)\/remove$/, function(req){
    var seedKey = req[1].toLowerCase();
    if(confirm("Delete seed " + seedKey + "?")) {
      api.removeSeed(seedKey, function(e){
        if(e) alert("Could not remove seed " + seedKey + ":\n" + e);
      });
    }
    history.go(-1);
  });

  r.fallback(function(){
    document.querySelectorAll("section.showhide").hide();
    if(typeof process == "object" && process.versions.node) r.go("#!/status")
  });

  // TODO: while waiting for the DHT to initialize, don't run the router

  r.run();

};

