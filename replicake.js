exports.start_replica = function(conf) {
  var time_start = new Date();
  var data_dir  = conf.get('data_dir');
  var seeds     = conf.get('seeds');
  var name      = conf.get('name') ||
                  ("replica-" + time_start.toJSON() + "-" + Math.random());

  console.info("replicake...")
  console.info("  time_start: " + time_start.toJSON());
  console.info("  data_dir: " + data_dir);
  console.info("  seeds: " + seeds);
  console.info("  name: " + name);

  return {
  }
}
