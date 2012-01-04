// Simple, memory-based storage for replicake that loads/saves to json file.
// Doesn't provide durability if process crashes.
//
var fs     = require('fs');
var path   = require('path');
var assert = require('assert');

exports.open = function(data_dir, name, conf, cb) {
  var data = {};
  var self = { // API is defined here in self.
               'close': function() { self = null; },
               'save': save,
               'add': todo };

  var log_dir  = data_dir + '/data-' + name;
  var log_file = log_dir + '/log_db.json';

  path.existsSync(data_dir) || fs.mkdirSync(data_dir);
  path.existsSync(log_dir)  || fs.mkdirSync(log_dir);

  path.exists(log_file,
              function(exists) {
                if (exists) {
                  load();
                } else {
                  cb(false, self);
                }
              });

  function load() {
    fs.readFile(log_file,
                function(err, json) {
                  if (!err) {
                    try {
                      data = JSON.parse(json);
                      cb(false, self);
                      return;
                    } catch (e) {
                      err = e;
                    }
                  }
                  cb(err);
                });
  }

  function save(cb) {
    if (self) {
      var tmp = log_file + '_' + (new Date().toJSON()) + '-' + Math.random();
      fs.writeFile(tmp, JSON.stringify(data),
                   function(err) {
                     fs.rename(tmp, log_file, cb);
                   });
    } else {
      cb(new Exception("log_db already closed: " + log_file));
    }
  }

  function todo() { assert(false); }
}

