const TuyAPI = require('tuyapi')
const Influx = require('influx')

const http = require('http');
const config = require(process.env.CONFIG || './config.json');

const port = process.env.PORT || 3000;

const influx = (config.influx ? new Influx.InfluxDB(config.influx) : null);

const DPS = {
  MODE: '4', // 'cold' or 'hot'.
  // 12 ??? 0
  UNIT: '101', // unused.
  CALIBRATION: '102', // tenths of deg. unused.
  STATUS: '103', // on, off, pause.
  CUR_TEMP_C: '104', // tenths of deg. unused.
  SP1: '106',// tenths of deg.
  DELAY_MINS: '108', // unused.
  ALARM_LOW: '109', // unused.
  ALARM_HIGH: '110', // unused.
  // 111, 112, 113 ??? false.
  SP2: '114', // tenths of deg.
  ACTIVE: '115',
  CUR_TEMP: '116' // tenths of deg.
}

const connections = {};
const controllers = {};

const start = function (name) {
  if (!(name in connections)) {
    console.log("creating connection to", name, "using", config.devices[name]);
    connections[name] = new TuyAPI(config.devices[name]);
  }
  dev = connections[name];
  console.log(name, "searching...");
  dev.find().then(() => {
    console.log(name, "connecting...");
    dev.connect();
  });

  dev.on('connected', () => { console.log(name, "connected!"); });
  dev.on('disconnected', () => {
    console.log(name, "disconnected!");
    delete controllers[name];
  });

  dev.on('error', error => { console.log(name, ' error:', error); });
  dev.on('data', raw => {
    data = raw['dps'];

    if (!(name in controllers)) {
      controllers[name] = {};
    }
    state = controllers[name];

    let changed = false;

    if (DPS.STATUS in data) {
      console.log(name, "status: ", data[DPS.STATUS]);
      state.status = data[DPS.STATUS];
      changed = true;
    }

    if (DPS.CUR_TEMP in data) {
      new_temp = data[DPS.CUR_TEMP] / 10.0;
      if (state.temp != new_temp) {
        console.log(name, "Temp changed: ", state.temp, " -> ", new_temp);
        changed = true;
      }
      state.temp = new_temp;
    }

    if (DPS.SP1 in data) {
      new_sp1 = data[DPS.SP1] / 10.0;
      if (state.sp1 != new_sp1) {
        console.log(name, "SP1 changed: ", state.sp1, " -> ", new_sp1);
        changed = true;
      }
      state.sp1 = new_sp1;
    }

    if (DPS.SP2 in data) {
      new_sp2 = data[DPS.SP2] / 10.0;
      if (state.sp2 != new_sp2) {
        console.log(name, "SP2 changed: ", state.sp2, " -> ", new_sp2);
        changed = true;
      }
      state.sp2 = new_sp2;
    }

    if (DPS.ACTIVE in data) {
      new_cooling = data[DPS.ACTIVE];
      if (state.cooling != new_cooling) {
        console.log(name, "Status changed: cooling ", state.cooling, " -> cooling ", new_cooling);
        changed = true;
      }
      state.cooling = data[DPS.ACTIVE];
    }
    if (changed) {
      state.changed = true;
    }
    state.updated = new Date();
  })
}

const loop = function(name) {
  setInterval(() => {
    if (!(name in controllers)) {
      console.log(name, "not connected?")
      start(name);
      return
    }

    state = controllers[name];

    if (state.status != 'on') {
      return
    }

    let now = new Date();
    let shouldLog = false;

    if (!state.logged) {
      console.log(name, 'initial log');
      shouldLog = true;
    } else {
      let age = new Date().getTime() - state.logged.getTime();
      if (state.changed && age > 1000) {
        console.log(name, 'changes to log');
        shouldLog = true;
      } else if (age > 60000) {
        console.log(name, 'minutely log');
        shouldLog = true;
      }
    }
    if (shouldLog) {
      console.log(name, now, state);
      if (influx) {
        influx.writeMeasurement(name, [
          {
            tags: {},
            fields: { temp: state.temp, sp: state.sp1, cooling: state.cooling, },
          }
        ])
      } else {
        console.log("influx logging disabled");
      }
      state.logged = new Date();
      state.changed = false;
    }
  }, 5000)
}

for (var name in config.devices) {
  loop(name);
}

const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(controllers, null, "  "));
});

server.listen(port, () => {
  console.log(`Server running at port ${port}`);
});