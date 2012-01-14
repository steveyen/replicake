var assert = require('assert');

var RES_NACK     = 1;
var REQ_PROPOSE  = 10;
var RES_PROPOSED = 11;
var REQ_ACCEPT   = 20;
var RES_ACCEPTED = 21;

function majority(n) {
  return Math.floor(n / 2) + 1;
}

function is_member(collection, item) {
  for (var i in collection) {
    if (collection[i] == item) {
      return true;
    }
  }
  return false;
}

// ----------------------------------------------------------------

exports.proposer = function(start_ballot, acceptors, key, opts) {
  assert(acceptors != null && acceptors.length > 0);
  assert(key != null);
  opts = opts || {};

  var proposer_timeout = opts.proposer_timeout || 3; // In seconds.
  var quorum           = opts.quorum || majority;

  var tot_propose_phase       = 0; // Stats counters.
  var tot_propose_phase_loop  = 0;
  var tot_propose_send        = 0;
  var tot_propose_recv        = 0;
  var tot_propose_recv_err    = 0;
  var tot_propose_vote        = 0;
  var tot_propose_vote_repeat = 0;

  var cur_ballot = start_ballot;
  function nxt_ballot() {
    cur_ballot = ballot_inc(cur_ballot);
    return cur_ballot;
  }

  function propose(val, cb) {
    var ballot = nxt_ballot();

    // The proposer has two phases: promise & accept, which
    // are similar and can share the same phase() logic.
    //
    phase({ "kind": REQ_PROPOSE, "ballot": ballot }, RES_PROPOSED,
          function(err) {
            if (err) {
              cb(err);
            } else {
              phase({ "kind": REQ_ACCEPT, "ballot": ballot }, RES_ACCEPTED, cb);
            }
          });

    function phase(req, yea_kind, cb_phase) {
      tot_propose_phase = tot_propose_phase + 1;

      broadcast(acceptors, req);

      var needs = quorum(acceptors.length);
      var tally = {};
      tally[yea_kind] = [ {}, needs, null ];
      tally[RES_NACK] = [ {}, acceptors.length - needs + 1, "rejected" ];

      var timer = null;
      function restart_timer() {
        timer = timer_start(proposer_timeout, function() {
            if (timer != null) {
              timer = null;
              cb_phase('timeout');
            }
          });
      }
      restart_timer();

      function on_recv(src, res) {
        if (timer != null) {
          timer_clear(timer);
          timer = null;

          tot_propose_recv = total_propose_recv + 1;

          // Stop when recv()'ed votes reach tally quorum, either yea or nay.
          //
          if (is_member(acceptors, src) &&
              res != null && res.req != null && res.req.ballot != null &&
              ballot_eq(res.req.ballot, ballot) &&
              tally[res.kind] != null) {
            var vkind = tally[res.kind];
            var votes = vkind[0];
            if (!is_member(votes, src)) {
              tot_propose_vote = tot_propose_vote + 1;
              votes[votes.length] = src;
              if (votes.length >= vkind[1]) {
                cb_phase(vkind[2], { "ballot": res.accepted_ballot,
                                     "val": res.accepted_val,
                                     "proposal_ballot": res.proposal_ballot });
                return;
              }
            } else {
              tot_propose_vote_repeat = tot_propose_vote_repeat + 1;
              log("paxos.propose - repeat vote: " + res + " from src: " + src);
            }
          } else {
            tot_propose_recv_err = tot_propose_recv_err + 1;
            log("paxos.propose - bad msg: " + res + " from src: " + src);
          }

          total_propose_phase_loop = tot_propose_phase_loop + 1;
          timer_restart();
        }
      }
    }
  }

  function stats() {
    return { "tot_propose_phase"       : tot_propose_phase,
             "tot_propose_phase_loop"  : tot_propose_phase_loop,
             "tot_propose_send"        : tot_propose_send,
             "tot_propose_recv"        : tot_propose_recv,
             "tot_propose_recv_err"    : tot_propose_recv_err,
             "tot_propose_vote"        : tot_propose_vote,
             "tot_propose_vote_repeat" : tot_propose_vote_repeat };
  }

  var self = {
    "propose_req": function(req, res) {},
    "propose_res": function(req, res) {},
    "stats": stats
  };
  return self;
};

// ----------------------------------------------------------------

exports.acceptor = function(key, opts) {
  assert(key != null);
  opts = opts || {};

  var acceptor_timeout = opts.acceptor_timeout || 3; // In seconds.
  var quorum           = opts.quorum || majority;

  var tot_accept_loop         = 0; // Stats counters.
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

  function accept(storage, initial_state) {
    initial_state = initial_state || {};

    var accepted_ballot = initial_state.accepted_ballot;
    var accepted_val = initial_state.accepted_val;
    var proposal_ballot = accepted_ballot;

    function response(to, msg) {
      msg.accepted_ballot = accepted_ballot; // Allow requestor to catch up to
      msg.accepted_val = accepted_val; // our currently accepted ballot+val.
      msg.proposal_ballot = proposal_ballot;
      send(to, self(), msg);
      tot_accept_send = total_accept_send + 1;
    }

    function process(req, kind, storage_fun) {
      if (ballot_gte(req.ballot, proposal_ballot)) {
      }
    }

    var timer = null;
    function timer_restart() {
      timer = timer_start(acceptor_timeout, function() {
          if (timer != null) {
            timer = null;
            cb_phase('timeout', { "accepted_ballot": accepted_ballot,
                                  "accepted_val": accepted_val });
          }
        });
    }
    timer_restart();

    function on_recv(req) {
      if (timer != null) {
        timer_clear(timer);
        timer = null;

        tot_accept_recv = tot_accept_recv + 1;
        if (req != null && req.ballot != null) {
          // The acceptor's main responsibility is to
          // process incoming prepare or accept requests.
          //
          // Both prepare and accept request handling are
          // similar, sharing the same process() helper function.
          //
          if (req.kind == REQ_PREPARE) {
            tot_accept_prepare = tot_accept_prepare + 1;
            comm.pause();
            process(req, RES_PREPRARED, storage.save_ballot,
                    function(err, res) {
                      if (!err) {
                        tot_accept_prepared = tot_accept_prepared + 1;
                        proposal_ballot = req.ballot;
                      }
                      respond(req.ballot[BALLOT_SRC], res);
                      comm.unpause();
                    });
          } else if (req.kind == REQ_ACCEPT) {
            tot_accept_accept = tot_accept_accept + 1;
            comm.pause();
            process(req, RES_ACCEPTED, storage.save_ballot_val,
                    function(err, res) {
                      if (!err) {
                        tot_accept_accepted = tot_accept_accepted + 1;
                        proposal_ballot = req.ballot;
                        accepted_ballot = req.ballot;
                        accepted_val = req.val;
                      }
                      respond(req.ballot[BALLOT_SRC], res);
                      comm.unpause();
                    });
          } else {
            tot_accept_bad_req_kind = tot_accept_bad_req_kind + 1;
            log("paxos.accepte - unknown req.kind: " + req.kind);
          }
        } else {
          tot_accept_bad_req = tot_accept_bad_req + 1;
          log("paxos.accepte - bad req");
        }

        tot_accept_loop = tot_accept_loop + 1;
        timer_restart();
      }
    }
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
             "tot_accept_nack_behind"  : tot_accept_nack_behind };
  }

  var self = {
    "accept_req": function(req, res) {},
    "accept_res": function(req, res) {},
    "stats": stats
  };
  return self;
};

// ----------------------------------------------------------------

var BALLOT_SEQ_NUM           = 0;
var BALLOT_PROPOSER          = 1;
var BALLOT_PROPOSER_RESTARTS = 2;

function ballot_mk(seq_num, proposer, proposer_restarts) {
  return [seq_num, proposer, proposer_restarts];
}

function ballot_inc(ballot) {
  return mk_ballot(ballot[BALLOT_SEQ_NUM] + 1,
                   ballot[BALLOT_PROPOSER],
                   ballot[BALLOT_PROPOSER_RESTARTS]);
}

var BOTTOM_BALLOT = ballot_mk(-1, -1, -1);

function ballot_gte(a, b) { // Greater than or equal.
  a = a || BOTTOM_BALLOT;
  b = b || BOTTOM_BALLOT;
  for (var i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] > b[i]) {
      return true;
    }
    if (a[i] < b[i]) {
      return false;
    }
  }
  return true;
}

function ballot_eq(a, b) {
  for (var i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] != b[i]) {
      return false;
    }
  }
  return true;
}

exports.ballot_mk  = ballot_mk;
exports.ballot_inc = ballot_inc;
exports.ballot_gte = ballot_gte;
exports.ballot_eq  = ballot_eq;

function ballot_test() {
  var a = ballot_mk(1, 0, 0);
  var assert = require('assert');
  assert(ballot_gte(a, BOTTOM_BALLOT));
  assert(ballot_gte(ballot_mk(1, 1, 1), a));
  assert(ballot_gte(ballot_mk(1, 1, 0), a));
  assert(ballot_gte(ballot_mk(1, 0, 1), a));
  assert(ballot_gte(ballot_mk(1, 0, 0), a));
  assert(!ballot_gte(ballot_mk(0, 0, 0), a));
  assert(!ballot_gte(ballot_mk(0, 0, 1), a));
  assert(!ballot_gte(ballot_mk(0, 1, 0), a));
  assert(!ballot_gte(ballot_mk(0, 1, 1), a));
}

