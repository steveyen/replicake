var assert = require('assert');

exports.start = function(slot) {
  assert(slot != null);
  var self = {
    "promise_req": function(req, res) {},
    "promise_res": function(req, res) {},
    "accept_req": function(req, res) {},
    "accept_res": function(req, res) {}
  };
  return self;
}

