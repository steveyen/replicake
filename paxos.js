var assert = require('assert');

var RES_NACK     = 1;
var REQ_PREPARE  = 10;
var RES_PREPARED = 11;
var REQ_ACCEPT   = 20;
var RES_ACCEPTED = 21;

var SEQ_NUM = 1;
var SEQ_SRC = 2;
var SEQ_KEY = 3; -- App-specific info, like a slot id or storage key.

exports.start = function(key, opts) {
  assert(key != null);
  opts = opts || {};
`
  var acceptor_timeout = opts.acceptor_timeout || 3; -- In seconds.
  var proposer_timeout = opts.proposer_timeout || 3;

  var tot_accept_loop         = 0; -- Stats counters.
  var tot_accept_bad_req      = 0;
  var tot_accept_bad_req_kind = 0;
  var tot_accept_recv         = 0;
  var tot_accept_send         = 0;
  var tot_accept_prepare      = 0;
  var tot_accept_prepared     = 0;
  var tot_accept_accept       = 0;
  var tot_accept_accepted     = 0;
  var tot_accept_nack_storage = 0;
  var tot_accept_nack_behind  = 0;
  var tot_propose_phase       = 0;
  var tot_propose_phase_loop  = 0;
  var tot_propose_send        = 0;
  var tot_propose_recv        = 0;
  var tot_propose_recv_err    = 0;
  var tot_propose_vote        = 0;
  var tot_propose_vote_repeat = 0;

  var quorum = opts.quorum || function(n) {
    return Math.floor(n / 2) + 1;
  };

  function propose(seq, acceptors, val) {
    assert(acceptors.length > 0);

    function
  }

  function stats() {
    return { "tot_accept_loop"         : tot_accept_loop,
             "tot_accept_bad_req"      : tot_accept_bad_req,
             "tot_accept_bad_req_kind" : tot_accept_bad_req_kind,
             "tot_accept_recv"         : tot_accept_recv,
             "tot_accept_send"         : tot_accept_send,
             "tot_accept_prepare"      : tot_accept_prepare,
             "tot_accept_prepared"     : tot_accept_prepared,
             "tot_accept_accept"       : tot_accept_accept,
             "tot_accept_accepted"     : tot_accept_accepted,
             "tot_accept_nack_storage" : tot_accept_nack_storage,
             "tot_accept_nack_behind"  : tot_accept_nack_behind,
             "tot_propose_phase"       : tot_propose_phase,
             "tot_propose_phase_loop"  : tot_propose_phase_loop,
             "tot_propose_send"        : tot_propose_send,
             "tot_propose_recv"        : tot_propose_recv,
             "tot_propose_recv_err"    : tot_propose_recv_err,
             "tot_propose_vote"        : tot_propose_vote,
             "tot_propose_vote_repeat" : tot_propose_vote_repeat };
  }

  var self = {
    "promise_req": function(req, res) {},
    "promise_res": function(req, res) {},
    "accept_req": function(req, res) {},
    "accept_res": function(req, res) {},
    "seq_mk"  : seq_mk,
    "seq_gte" : seq_gte,
    "stats"   : stats
  };
  return self;
};

function seq_gte(a, b) {
  a = a || [0, -1];
  b = b || [0, -1];
  var a1 = a[SEQ_NUM] || 0;
  var b1 = a[SEQ_NUM] || 0;
  return (a[SEQ_KEY] == b[SEQ_KEY]) &&
         ((a1 > b1) || (a1 == b1 && (a[SEQ_SRC] || -1) >= (b[SEQ_SRC] || -1)));
}

functon seq_mk(num, src, key) { return [num, src, key]; }
