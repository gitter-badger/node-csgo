var EventEmitter = require('events').EventEmitter,
    util = require("util"),
    protos = require("./protos"),
    protoMask = 0x80000000,
    bignumber = require("bignumber.js"),
    CSGO = exports;

var CSGOClient = function CSGOClient(steamClient, steamUser, steamGC, debug) {
  EventEmitter.call(this);

  this.debug = debug || false;
  this._client = steamClient;
  this._user = steamUser;
  this._gc = steamGC;
  this._appid = 730;
  this.chatChannels = []; // Map channel names to channel data.
  this._gcReady = false;
  this._gcClientHelloIntervalId = null;

  var self = this;
  this._gc.on('message', function(type, message, callback) {
    callback = callback || null;

    var kMsg = type.msg & ~protoMask;
    if (self.debug) {
      util.log("CS:GO fromGC: " + kMsg);  // TODO:  Turn type-protoMask into key name.
    }

    if (kMsg in self._handlers) {
      if (callback) {
        self._handlers[kMsg].call(self, message, callback);
      }
      else {
        self._handlers[kMsg].call(self, message);
      }
    }
    else {
      self.emit("unhandled", kMsg);
    }
  });

  this._sendClientHello = function() {
    if (self.debug) {
      util.log("Sending ClientHello");
    }
    if (!self._client) {
      util.log("Client went missing");
    }
    else {
      self._gc.send({msg: CSGO.EGCBaseClientMsg.k_EMsgGCClientHello, proto: {}},
          new protos.CMsgClientHello({}).toBuffer());
    }
  };
};
util.inherits(CSGOClient, EventEmitter);

require("./generated/messages");

CSGOClient.prototype.ServerRegion = CSGO.ServerRegion;
CSGOClient.prototype.GameMode = CSGO.GameMode;

CSGOClient.prototype.ToAccountID = function(accid){
  return new bignumber(accid).minus('76561197960265728')-0;
};

CSGOClient.prototype.ToSteamID = function(accid){
  return new bignumber(accid).plus('76561197960265728')+"";
};

// Methods
CSGOClient.prototype.launch = function() {
  /* Reports to Steam that we are running Counter-Strike: Global Offensive. Initiates communication with GC with EMsgGCClientHello */
  if (this.debug) {
    util.log("Launching CS:GO");
  }
  this._user.gamesPlayed({
    games_played: [{
      game_id: '730'
    }]
  });

  // Keep knocking on the GCs door until it accepts us.
  this._gcClientHelloIntervalId = setInterval(this._sendClientHello, 2500);
};

CSGOClient.prototype.exit = function() {
  /* Reports to Steam we are not running any apps. */
  if (this.debug) {
    util.log("Exiting CS:GO");
  }

  /* stop knocking if exit comes before ready event */
  if (this._gcClientHelloIntervalId) {
      clearInterval(this._gcClientHelloIntervalId);
      this._gcClientHelloIntervalId = null;
  }
  this._gcReady = false;
  this._client.gamesPlayed([]);
};


// Handlers

var handlers = CSGOClient.prototype._handlers = {};

handlers[CSGO.EGCBaseClientMsg.k_EMsgGCClientWelcome] = function clientWelcomeHandler(message) {
  /* Response to our k_EMsgGCClientHello, now we can execute other GC commands. */

  // Only execute if _gcClientHelloIntervalID, otherwise it's already been handled (and we don't want to emit multiple 'ready');
  if (this._gcClientHelloIntervalId) {
    clearInterval(this._gcClientHelloIntervalId);
    this._gcClientHelloIntervalId = null;

    if (this.debug) {
      util.log("Received client welcome.");
    }
    this._gcReady = true;
    this.emit("ready");
  }
};

handlers[CSGO.EGCBaseClientMsg.k_EMsgGCClientConnectionStatus] = function gcClientConnectionStatus(message) {
  /* Catch and handle changes in connection status, cuz reasons u know. */

  var status = protos.CMsgConnectionStatus.decode(message).status;

  switch (status) {
    case CSGO.GCConnectionStatus.GCConnectionStatus_HAVE_SESSION:
      if (this.debug) {
        util.log("GC Connection Status regained.");
      }

      // Only execute if _gcClientHelloIntervalID, otherwise it's already been handled (and we don't want to emit multiple 'ready');
      if (this._gcClientHelloIntervalId) {
        clearInterval(this._gcClientHelloIntervalId);
        this._gcClientHelloIntervalId = null;

        this._gcReady = true;
        this.emit("ready");
      }
      break;

    default:
      if (this.debug) {
        util.log("GC Connection Status unreliable - " + status);
      }

      // Only execute if !_gcClientHelloIntervalID, otherwise it's already been handled (and we don't want to emit multiple 'unready');
      if (!this._gcClientHelloIntervalId) {
        this._gcClientHelloIntervalId = setInterval(this._sendClientHello, 2500); // Continually try regain GC session

        this._gcReady = false;
        this.emit("unready");
      }
      break;
  }
};

CSGO.CSGOClient = CSGOClient;

require("./handlers/match");
