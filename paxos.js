var assert = require('assert');

var RES_NACK     = exports.RES_NACK     = 1;
var REQ_PROPOSE  = exports.REQ_PROPOSE  = 10;
var RES_PROPOSED = exports.RES_PROPOSED = 11;
var REQ_ACCEPT   = exports.REQ_ACCEPT   = 20;
var RES_ACCEPTED = exports.RES_ACCEPTED = 21;

exports.proposer = function(node_name, node_restarts, slot,
                            acceptors, comm, opts) {
  assert(node_name != null);
  assert(node_restarts > 0);
  assert(acceptors.length > 0);

  opts = opts || {};
  var proposer_timeout = opts.proposer_timeout || 3000; // In milliseconds.
  var quorum           = opts.quorum || majority;

  var tot_propose_phase       = 0; // Stats counters.
  var tot_propose_phase_loop  = 0;
  var tot_propose_send        = 0;
  var tot_propose_recv        = 0;
  var tot_propose_recv_err    = 0;
  var tot_propose_vote        = 0;
  var tot_propose_vote_repeat = 0;
  var tot_propose_timeout     = 0;

  function propose(val, cb) {
    var self = {};
    var timer = null;
    var ballot = next_ballot();

    var accepted_ballot = BOTTOM_BALLOT;
    var accepted_val    = null;

    // Run through two similar, sequential phases: propose & accept.
    //
    phase(REQ_PROPOSE, RES_PROPOSED, {},
          function(err, info) {
            if (err) {
              cb(err, info);
            } else {
              if (info.accepted_ballot &&
                  info.accepted_val) {
                val = info.accepted_val;
              }
              phase(REQ_ACCEPT, RES_ACCEPTED, { "val": val }, cb);
            }
          });

    function phase(kind, yea_kind, req, cb_phase) {
      tot_propose_phase = tot_propose_phase + 1;

      req.slot   = slot;
      req.kind   = kind;
      req.ballot = ballot;
      req.sender = node_name;
      comm.broadcast(acceptors, req);
      tot_propose_send = tot_propose_send + acceptors.length;
      restart_timer();

      var yea_needed = quorum(acceptors.length);
      var nay_needed = acceptors.length - yea_needed + 1;

      var tally = {};
      tally[yea_kind] = [ [], yea_needed, null ];
      tally[RES_NACK] = [ [], nay_needed, "rejected" ];

      self.on_msg = function(src, res) {
        tot_propose_recv = tot_propose_recv + 1;

        if (!timer) {
          return; // Drop/ignore late messages.
        }
        if (timer) {
          clearTimeout(timer);
        }
        timer = null;

        if (opts.msg_preprocess) {
          res = opts.msg_preprocess(src, res);
        }

        // Stop when recv()'ed votes reach tally quorum, either yea or nay.
        //
        if (is_member(acceptors, src) &&
            res != null &&
            ballot_eq(res.ballot, ballot) &&
            tally[res.kind] != null) {
          var vkind = tally[res.kind];
          var votes = vkind[0];

          if (!is_member(votes, src)) {
            tot_propose_vote = tot_propose_vote + 1;

            if (ballot_gte(res.accepted_ballot, accepted_ballot)) {
              accepted_ballot = res.accepted_ballot;
              accepted_val    = res.accepted_val;
            }

            votes[votes.length] = src;
            if (votes.length >= vkind[1]) {
              if (opts.on_phase_complete) {
                opts.on_phase_complete(yea_kind, vkind[2]);
              }
              cb_phase(vkind[2],
                       { "highest_proposed_ballot": res.highest_proposed_ballot,
                         "accepted_ballot":         accepted_ballot,
                         "accepted_val":            accepted_val });
              return;
            }
          } else {
            tot_propose_vote_repeat = tot_propose_vote_repeat + 1;
          }
        } else {
          tot_propose_recv_err = tot_propose_recv_err + 1;
        }

        tot_propose_phase_loop = tot_propose_phase_loop + 1;
        restart_timer();
      }

      function restart_timer() {
        assert(!timer);
        timer = setTimeout(function() {
                             tot_propose_timeout = tot_propose_timeout + 1;
                             if (timer != null) {
                               timer = null;
                               cb_phase('timeout');
                             }
                           }, proposer_timeout);
      }
    }

    return self; // Provids a self.on_msg(src, msg) function.
  }

  var cur_ballot = ballot_mk(-1, node_name, node_restarts);
  function next_ballot() {
    cur_ballot = ballot_inc(cur_ballot);
    return cur_ballot;
  }

  function stats() {
    return { "tot_propose_phase"       : tot_propose_phase,
             "tot_propose_phase_loop"  : tot_propose_phase_loop,
             "tot_propose_send"        : tot_propose_send,
             "tot_propose_recv"        : tot_propose_recv,
             "tot_propose_recv_err"    : tot_propose_recv_err,
             "tot_propose_vote"        : tot_propose_vote,
             "tot_propose_vote_repeat" : tot_propose_vote_repeat,
             "tot_propose_timeout"     : tot_propose_timeout };
  }

  return { "propose": propose, "stats": stats };
};

// ----------------------------------------------------------------

exports.acceptor = function(storage, comm, opts) {
  opts = opts || {};
  var quorum = opts.quorum || majority;

  var tot_accept_bad_req      = 0; // Stats counters.
  var tot_accept_bad_req_kind = 0;
  var tot_accept_recv         = 0;
  var tot_accept_send         = 0;
  var tot_accept_propose      = 0;
  var tot_accept_proposed     = 0;
  var tot_accept_accept       = 0;
  var tot_accept_accepted     = 0;
  var tot_accept_nack_storage = 0;
  var tot_accept_nack_behind  = 0;

  function on_msg(src, req) {
    tot_accept_recv = tot_accept_recv + 1;
    if (req != null &&
        req.slot != null &&
        req.ballot != null) {
      // The acceptor's main responsibility is to process incoming
      // propose or accept requests with higher ballots.
      //
      storage.slot_read(req.slot, on_slot_read);

      function on_slot_read(err, slot_state) {
        if (!err) {
          var highest_proposed_ballot = slot_state.highest_proposed_ballot;

          if (ballot_gte(req.ballot, highest_proposed_ballot)) {
            if (req.kind == REQ_PROPOSE) {
              tot_accept_propose = tot_accept_propose + 1;
              storage.slot_save_highest_proposed_ballot(
                req.slot, req.ballot,
                function(err) {
                  if (!err) {
                    tot_accept_proposed = tot_accept_proposed + 1;
                    highest_proposed_ballot = req.ballot;
                    respond(RES_PROPOSED,
                            { "accepted_ballot": slot_state.accepted_ballot,
                              "accepted_val":    slot_state.accepted_val });
                  } else {
                    tot_accept_nack_storage = tot_accept_nack_storage + 1;
                    respond(RES_NACK);
                  }
                });
            } else if (req.kind == REQ_ACCEPT) {
              tot_accept_accept = tot_accept_accept + 1;
              storage.slot_save_accepted(
                req.slot, req.ballot, req.val,
                function(err) {
                  if (!err) {
                    tot_accept_accepted = tot_accept_accepted + 1;
                    highest_proposed_ballot = req.ballot;
                    respond(RES_ACCEPTED,
                            { "accepted_ballot": req.ballot,
                              "accepted_val":    req.val });
                  } else {
                    tot_accept_nack_storage = tot_accept_nack_storage + 1;
                    respond(RES_NACK);
                  }
                });
            } else {
              tot_accept_bad_req_kind = tot_accept_bad_req_kind + 1;
              respond(RES_NACK);
            }
          } else {
            tot_accept_nack_behind = tot_accept_nack_behind + 1;
            respond(RES_NACK);
          }

          function respond(kind, msg) {
            msg = msg || {};
            msg.highest_proposed_ballot = highest_proposed_ballot;
            respond_full(req, kind, msg);
          }
        } else {
          tot_accept_nack_storage = tot_accept_nack_storage + 1;
          respond_full(req, RES_NACK, {});
        }
      }
    } else {
      tot_accept_bad_req = tot_accept_bad_req + 1;
    }
  }

  function respond_full(req, kind, msg) {
    msg.kind = kind;
    msg.slot = req.slot;
    msg.ballot = req.ballot;
    if (opts.respond_preprocess) {
      msg = opts.respond_preprocess(msg);
    }
    comm.send(req.sender, msg);
    tot_accept_send = tot_accept_send + 1;
  }

  function stats() {
    return { "tot_accept_bad_req"      : tot_accept_bad_req,
             "tot_accept_bad_req_kind" : tot_accept_bad_req_kind,
             "tot_accept_recv"         : tot_accept_recv,
             "tot_accept_send"         : tot_accept_send,
             "tot_accept_propose"      : tot_accept_propose,
             "tot_accept_proposed"     : tot_accept_proposed,
             "tot_accept_accept"       : tot_accept_accept,
             "tot_accept_accepted"     : tot_accept_accepted,
             "tot_accept_nack_storage" : tot_accept_nack_storage,
             "tot_accept_nack_behind"  : tot_accept_nack_behind };
  }

  return { "on_msg": on_msg, "stats": stats };
};

// ----------------------------------------------------------------

function majority(n) {
  return Math.floor(n / 2) + 1;
}
exports.majority = majority;

function is_member(collection, item) {
  for (var i in collection) {
    if (collection[i] == item) {
      return true;
    }
  }
  return false;
}
exports.is_member = is_member;

// ----------------------------------------------------------------

var BALLOT_SEQ_NUM           = exports.BALLOT_SEQ_NUM           = 0;
var BALLOT_PROPOSER_NAME     = exports.BALLOT_PROPOSER_NAME     = 1;
var BALLOT_PROPOSER_RESTARTS = exports.BALLOT_PROPOSER_RESTARTS = 2;

function ballot_mk(seq_num, proposer_name, proposer_restarts) {
  return [seq_num, proposer_name, proposer_restarts];
}

var BOTTOM_BALLOT = ballot_mk(-1, -1, -1);

function ballot_inc(ballot) {
  return ballot_mk(ballot[BALLOT_SEQ_NUM] + 1,
                   ballot[BALLOT_PROPOSER_NAME],
                   ballot[BALLOT_PROPOSER_RESTARTS]);
}

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
