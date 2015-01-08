/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://www.mozilla.org/MPL/2.0/. */


/*
this._tldCookieCounter = {
  "[youtube.com]-[user@gmail.com]-[google.com]": 5
}

this._auths = {
  "google.com": [   // tld (encoded)
    "efghijklmnop", // user (encoded)
    "abcdefghijkl"
  ],
  "twtter.com": [
    "efghijklmnop",
  ]


this._loggedInTabs = {
  "my-app.com": [   // tabTld (encoded)
    "google.com",   // _auths[tld] (encoded)
    "facebook.com",
    "twitter.com"
  ],
  "orkut.com": [
    "google.com"
  ],
*/


var LoginDB = {

  _auths: null,
  _loggedInTabs: null,
  _tldCookieCounter: null, // invalidateAfterCookieAddition (optimizes _invalidate calls)
  _invalidated: true,


  init: function() {
    Services.obs.addObserver(this._onCookieRejected, "third-party-cookie-rejected", false);
    Services.obs.addObserver(this._onCookieRejected, "cookie-rejected", false);
    Services.obs.addObserver(this._onCookieChanged, "cookie-changed", false);
  },


  uninit: function() {
    Services.obs.removeObserver(this._onCookieRejected, "third-party-cookie-rejected");
    Services.obs.removeObserver(this._onCookieRejected, "cookie-rejected");
    Services.obs.removeObserver(this._onCookieChanged, "cookie-changed");
  },


  _reset: function() {
    this._auths = Object.create(null);
    this._loggedInTabs = Object.create(null);
    this._tldCookieCounter = Object.create(null);
    this._invalidated = false;
  },

  _invalidate: function() {
    console.trace("_invalidate");
    this._invalidated = true;
  },

  _ensureValid: function() {
    if (this._invalidated) {
      this._update();
      this._invalidated = false;
    }
  },


  setDefaultUser: function(encodedTld, user) { // TODO setDefaultTopLogin
    console.assert(typeof encodedTld === "string", "encodedTld =", encodedTld);
    this._ensureValid();

    if ((encodedTld in this._loggedInTabs) === false) {
      console.log("LoginDB.setDefaultUser", "encodedTld not found", encodedTld);
      return;
    }

    if ((user.encodedTld in this._auths) === false) {
      console.log("LoginDB.setDefaultUser", "user.encodedTld not found", user.encodedTld, user.plainTld);
      return;
    }

    var authTlds = this._loggedInTabs[encodedTld]; // usually len=1
    var idx2 = authTlds.indexOf(user.encodedTld);
    if (idx2 > 0) { // [0] => already the default
      authTlds.splice(idx2, 1);
      authTlds.unshift(user.encodedTld);
      console.log("LoginDB.setDefaultUser updated", user.encodedTld, encodedTld, JSON.stringify(this._loggedInTabs[encodedTld], null, 2));
    }


    var allUsers = this._auths[user.encodedTld];
    var idx1 = allUsers.indexOf(user.encodedName);
    switch (idx1) {
      case 0:
        // nop: user is already the default
        break;
      case -1:
        // user not found (cookies cleared?)
        if (user.isNewAccount) {
          console.log("LoginDB.setDefaultUser NewAccount", user.encodedTld, this._auths[user.encodedTld].toSource(), allUsers.toSource());
          allUsers.unshift(UserUtils.NewAccount);
        }
        break;
      default:
        allUsers.splice(idx1, 1);
        allUsers.unshift(user.encodedName); // [0] => default
        console.log("LoginDB.setDefaultUser updated1", user.plainName, user.encodedName, user.encodedTld, this._auths[user.encodedTld].toSource());
        break;
    }
  },


  getDefaultUser: function(encTld) {
    if (this.isLoggedIn(encTld) === false) {
      return null;
    }

    // obs: loginUser16/loginTld may be null
    var loginTlds = this._loggedInTabs[encTld];
    var defaultFormTld = loginTlds[0];

    console.assert(defaultFormTld in this._auths, "this._auths", defaultFormTld, "/", encTld);
    var users = this._auths[defaultFormTld];
    console.assert(users.length > 0, "users.length");

    var defaultUser = users[0];
    return new UserId(defaultUser, defaultFormTld);
  },


  invalidateAfterCookieAddition: function(internalHostname) {
    var encodedLogin = UserUtils.getEncodedLogin(internalHostname);
    if (encodedLogin === null) {
      return;
    }
    var encodedData = encodedLogin.rawData;
    if (encodedData in this._tldCookieCounter) {
      this._tldCookieCounter[encodedData]++;
    } else {
      this._tldCookieCounter[encodedData] = 1;
      this._invalidate(); // new login?
    }
  },


  invalidateAfterCookieDeletion: function(internalHostname) {
    var counter = this._tldCookieCounter;
    if (counter === null) {
      return false;
    }
    var encodedLogin = UserUtils.getEncodedLogin(internalHostname);
    if (encodedLogin === null) {
      return false;
    }
    var encodedData = encodedLogin.rawData;
    console.assert(encodedData in counter, "!encodedData in this._tldCookieCounter", encodedData, counter);
    counter[encodedData]--;
    if (counter[encodedData] > 0) {
      return false;
    }
    delete counter[encodedData];
    this._invalidate(); // login removed?
    return true; // confirm invalidation
  },


  _update: function() {
    console.trace("LoginDB._update");
    var oldAuths = this._auths; // save current defaults
    var oldLoggedInTabs = this._loggedInTabs;
    this._reset();

    var all = CookieUtils.getAuthCookies();
    setWelcomeMode(all.length === 0);

    var encodedLogin;
    var encodedData; // "[youtube.com]-[user@gmail.com]-[google.com]"
    var tabTld;
    var loginUser;
    var loginTld;

    for (var idx = all.length - 1; idx > -1; idx--) {
      encodedLogin = UserUtils.getEncodedLogin(all[idx].host);
      if (encodedLogin === null) {
        continue; // default cookie
      }

      encodedData = encodedLogin.rawData;
      if (encodedData in this._tldCookieCounter) {
        this._tldCookieCounter[encodedData]++;
      } else {
        this._tldCookieCounter[encodedData] = 1;
      }

      loginTld  = encodedLogin.loginTld;
      loginUser = encodedLogin.loginUser;
      if (loginTld in this._auths) {
        var authUsers = this._auths[loginTld];
        if (authUsers.indexOf(loginUser) === -1) {
          if (authUsers[0] === UserUtils.NewAccount) {
            authUsers.unshift(loginUser); // avoid NewAccount to be the default
          } else {
            authUsers.push(loginUser);
          }
        }
      } else {
        this._auths[loginTld] = [loginUser];
      }

      tabTld = encodedLogin.tabTld;
      if (tabTld in this._loggedInTabs) {
        var authTlds = this._loggedInTabs[tabTld];
        if (authTlds.indexOf(loginTld) === -1) {
          authTlds.push(loginTld);
        }
      } else {
        this._loggedInTabs[tabTld] = [loginTld];
      }

    }

    // keep default users
    var tld;
    var name;
    for (var tabTld in oldLoggedInTabs) {
      tld = oldLoggedInTabs[tabTld][0];
      name = oldAuths[tld][0];
      this.setDefaultUser(tabTld, new UserId(name, tld));
    }
  },

  /*
  hasLoggedInHost: function(hosts) {
    var encTld;
    for (var idx = hosts.length - 1; idx > -1; idx--) {
      encTld = StringEncoding.encode(getTldFromHost(hosts[idx]));
      if (this.isLoggedIn(encTld)) { // TODO perf: keep a plain tld list + getEncodedTld(tld)
        return true;
      }
    }
    return false;
  },
  */

  isLoggedIn: function(encTld) {
    this._ensureValid();
    return encTld in this._loggedInTabs;
  },


  getUsers: function(encDocTld) { // (ignoring NewAccount)
    this._ensureValid();
    if ((encDocTld in this._loggedInTabs) === false) {
      return [];
    }

    var authTlds = this._loggedInTabs[encDocTld];
    var tabUsers = [];
    var usr;
    var users;
    var loginTld;

    // TODO test multiple sites eg bugzilla + amo
    for (var idx1 = authTlds.length - 1; idx1 > -1; idx1--) {
      loginTld = authTlds[idx1];
      users = this._auths[loginTld];
      for (var idx2 = users.length - 1; idx2 > -1; idx2--) {
        usr = new UserId(users[idx2], loginTld);
        if (usr.isNewAccount === false) {
          tabUsers.push(usr);
        }
      }
    }

    // alphabetical sort
    tabUsers.sort(function(userA, userB) {
      return userB.plainName.localeCompare(userA.plainName);
    });

    return tabUsers;
  },


  _onCookieRejected: {
    observe: function(subject, topic, data) { // nsIObserver
      console.log(topic, subject, data);
    }
  },

  _onCookieChanged: {
    observe: function(subject, topic, data) { // nsIObserver
      try { // detect silent exceptions
        this._observe(subject, topic, data);
      } catch(ex) {
        console.error(ex);
      }
    },

    _observe: function(subject, topic, data) {
      if (LoginDB._loggedInTabs === null) {
        return;
      }
      switch (data) {
        case "changed":
          break;
        case "added":
          var cookie = subject.QueryInterface(Ci.nsICookie2);
          LoginDB.invalidateAfterCookieAddition(cookie.host);
          break;
        case "deleted":
          var cookie = subject.QueryInterface(Ci.nsICookie2);
          LoginDB.invalidateAfterCookieDeletion(cookie.host);
          break;
        case "batch-deleted":
          var all = subject.QueryInterface(Ci.nsIArray).enumerate();
          //console.log("cookie BATCH-DELETED!", data, all);
          while (all.hasMoreElements()) {
            var cookie = all.getNext().QueryInterface(Ci.nsICookie2);
            if (LoginDB.invalidateAfterCookieDeletion(cookie.host)) {
              break; // already invalidated, it is not necessary to continue
            }
          }
          break;
        case "cleared":
          LoginDB._reset();
          break;
        case "reload":
          LoginDB._invalidate();
          break;
        default:
          LoginDB._invalidate(); // ???
          break;
      }
    }
  }
};
