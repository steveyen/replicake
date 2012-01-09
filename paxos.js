var assert = require('assert');

var RES_NACK     = 1;
var REQ_PROPOSE  = 10;
var RES_PROPOSED = 11;
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

  function accept(storage, initial_state) {
    initial_state = initial_state || {};

    var accepted_seq = initial_state.accepted_seq;
    var accepted_val = initial_state.accepted_val;
    var proposal_seq = accepted_seq;

    function response(to, msg) {
      msg.accepted_seq = accepted_seq; // Allow requestor to catch up to
      msg.accepted_val = accepted_val; // our currently accepted seq+val.
      msg.proposal_seq = proposal_seq;
      send(to, self(), msg);
      tot_accept_send = total_accept_send + 1;
    }

    function process(req, kind, storage_fun) {
      if (seq_gte(req.seq, proposal_seq)) {

      }
    }

    var timer = null;
    function restart_timer() {
      timer = start_timer(acceptor_timeout, function() {
          if (timer != null) {
            timer = null;
            cb_phase('timeout', { "accepted_seq": accepted_seq,
                                  "accepted_val": accepted_val });
          }
        });
    }
    restart_timer();

    function on_recv(req) {
      if (timer != null) {
        clear_timer(timer);
        timer = null;

        tot_accept_recv = tot_accept_recv + 1;
        if (req != null && req.seq != null && req.seq[SEQ_SRC] != null) {
          // The acceptor's main responsibility is to
          // process incoming prepare or accept requests.
          //
          // Both prepare and accept request handling are
          // similar, sharing the same process() helper function.
          //
          if (req.kind == REQ_PREPARE) {
            tot_accept_prepare = tot_accept_prepare + 1;
            comm.pause();
            process(req, RES_PREPRARED, storage.save_seq,
                    function(err, res) {
                      if (!err) {
                        tot_accept_prepared = tot_accept_prepared + 1;
                        proposal_seq = req.seq;
                      }
                      respond(req.seq[SEQ_SRC], res);
                      comm.unpause();
                    });
          } else if (req.kind == REQ_ACCEPT) {
            tot_accept_accept = tot_accept_accept + 1;
            comm.pause();
            process(req, RES_ACCEPTED, storage.save_seq_val,
                    function(err, res) {
                      if (!err) {
                        tot_accept_accepted = tot_accept_accepted + 1;
                        proposal_seq = req.seq;
                        accepted_seq = req.seq;
                        accepted_val = req.val;
                      }
                      respond(req.seq[SEQ_SRC], res);
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
        restart_timer();
      }
    }
  }

  function propose(seq, acceptors, val, cb) {
    assert(acceptors.length > 0);

    function phase(req, yea_vote_kind, cb_phase) {
      tot_propose_phase = tot_propose_phase + 1;

      for (acceptor in acceptors) {
        send(acceptor, req);
      }

      var needs = quorum(acceptors.length);
      var tally = {};
      tally[yea_vote_kind] = [ {}, needs, null ];
      tally[RES_NACK]      = [ {}, acceptors.length - needs + 1, "rejected" ];

      var timer = null;
      function restart_timer() {
        timer = start_timer(proposer_timeout, function() {
            if (timer != null) {
              timer = null;
              cb_phase('timeout');
            }
          });
      }
      restart_timer();

      function on_recv(src, res) {
        if (timer != null) {
          clear_timer(timer);
          timer = null;

          tot_propose_recv = total_propose_recv + 1;

          // Stop when recv()'ed votes reach tally quorum, either yea or nay.
          //
          if (arr_member(acceptors, src) &&
              res != null && res.req != null && res.req.seq != null &&
              res.req.seq[SEQ_NUM] == seq[SEQ_NUM] &&
              res.req.seq[SEQ_SRC] == seq[SEQ_SRC] &&
              res.req.seq[SEQ_KEY] == seq[SEQ_KEY] &&
              tally[res.kind] != null) {
            var vkind = tally[res.kind];
            var votes = vkind[0];
            if (!arr_member(votes, src)) {
              tot_propose_vote = tot_propose_vote + 1;
              votes[votes.length] = src;
              if (votes.length > vkind[1]) {
                cb_phase(vkind[2], { "seq": res.accepted_seq,
                                     "val": res.accepted_val,
                                     "proposal_seq": res.proposal_seq });
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
          restart_timer();
        }
      }
    }

    // The proposer has two phases: promise & accept, which
    // are similar and can share the same phase() logic.
    //
    phase({ "kind": REQ_PROPOSE, "seq": seq }, RES_PROPOSED,
          function(err) {
            if (err) {
              cb(err);
            } else {
              phase({ "kind": REQ_ACCEPT, "seq": seq }, RES_ACCEPTED, cb);
            }
          });
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

function seq_mk(num, src, key) { return [num, src, key]; }

function arr_member(arr, item) {
  for (var x in arr) {
    if (x == item) {
      return true;
    }
  }
  return false;
}
