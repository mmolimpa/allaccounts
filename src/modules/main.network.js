/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


var NetworkObserver = {

  start: function() {
    var obs = Services.obs;
    obs.addObserver(this._request, "http-on-modify-request", false);
    obs.addObserver(this._response, "http-on-examine-response", false);
  },


  stop: function() {
    var obs = Services.obs;
    obs.removeObserver(this._request, "http-on-modify-request");
    obs.removeObserver(this._response, "http-on-examine-response");
  },


  _request: {
    // nsIObserver
    observe: function HttpListeners_request(subject, topic, data) {
      var httpChannel = subject.QueryInterface(Ci.nsIHttpChannel);
      var myChannel = new ChannelProperties(httpChannel);
      var uri = httpChannel.URI;
      var isWin = false;
      var fromContent = true;
      var win = myChannel.linkedWindow;
      var docUser;

      switch (myChannel.channelType) {
        case myChannel.CHANNEL_CONTENT_ASSET:
          docUser = WinMap.getUserForAssetUri(getDOMUtils(win).currentInnerWindowID, uri);
          break;
        case myChannel.CHANNEL_CONTENT_WIN:
          docUser = NewDocUser.addDocumentRequest(fillDocReqData(win), uri);
          isWin = true;
          break;
        case myChannel.CHANNEL_VIEW_SOURCE:
          console.log("REQUEST - viewsource", uri);
          docUser = NewDocUser.viewSourceRequest(win, uri);
          fromContent = false;
          break;
        default: // myChannel.CHANNEL_UNKNOWN
          // request from chrome (favicon, updates, <link rel="next"...)
          // safebrowsing, http://wpad/wpad.dat
          // private window
          return;
      }


      if (docUser === null) {
        if (fromContent) {
          // log to topData.thirdPartyUsers
          UserState.addRequest(uri, win, isWin, null);
          if (LoginDB.isLoggedIn(StringEncoding.encode(getTldFromHost(uri.host)))) {
            console.log("REQ ERR - login found but not used!", isWin, uri, win.location.href, getDOMUtils(win).currentInnerWindowID);
          }
        }
        return; // send default cookies
      }


      // log to topData.thirdPartyUsers
      var userHost = docUser.getHost(uri.host);
      if (fromContent) {
        UserState.addRequest(uri, win, isWin, userHost.user);
      }

      /*
      var myHeaders = myChannel.headersFromRequest();
      if (myHeaders["authorization"] !== null) {
        // docUser + authorization = not supported
        enableErrorMsgLocal("authorization", win);
      }
      */

      var userUri = httpChannel.URI.clone();
      userUri.host = userHost.toJar();
      var cookie = Cookies.getCookie(false, userUri);
      httpChannel.setRequestHeader("Cookie", cookie, false);
    }
  },

  _response: {
    // nsIObserver
    observe: function HttpListeners_response(subject, topic, data) {
      var httpChannel = subject.QueryInterface(Ci.nsIHttpChannel);
      var myChannel = new ChannelProperties(httpChannel);
      var uri = httpChannel.URI;
      var win = myChannel.linkedWindow;
      var winutils = win === null ? null : getDOMUtils(win);
      var docUser;

      switch (myChannel.channelType) {
        case myChannel.CHANNEL_CONTENT_ASSET:
          docUser = WinMap.getUserForAssetUri(winutils.currentInnerWindowID, uri);
          break;
        case myChannel.CHANNEL_CONTENT_WIN:
          docUser = NewDocUser.addDocumentResponse(httpChannel,
                                                   winutils.currentInnerWindowID,
                                                   winutils.outerWindowID);
          break;
        case myChannel.CHANNEL_VIEW_SOURCE:
          throw new Error("_response => CHANNEL_VIEW_SOURCE");
        default:
          return;
      }


      if (docUser === null) {
        if (LoginDB.isLoggedIn(StringEncoding.encode(getTldFromHost(uri.host)))) {
          console.log("RESPONSE ERR - login found but not used!", uri, win.location.href, winutils.currentInnerWindowID);
        }
        return;
      }

      var myHeaders = myChannel.headersFromResponse();

      var setCookies = myHeaders["set-cookie"];
      if (setCookies === null) {
        return;
      }

      if (myHeaders["www-authenticate"] !== null) {
        // docUser + www-authenticate = not supported
        enableErrorMsgLocal("www-authenticate", win);
      }

      // remove "Set-Cookie"
      httpChannel.setResponseHeader("Set-Cookie", null, false);

      Cookies.setCookie(docUser, uri, setCookies, false);
    }
  }
};



function fillDocReqData(win) {
  var utils = getDOMUtils(win);

  if (isTopWindow(win) === false) {
    console.assert(win.opener === null, "is an iframe supposed to have an opener?");
    var utilsParent = getDOMUtils(win.parent);
    return {
      __proto__ :  null,
      outer:       utils.outerWindowID,
      visibleInner:utils.currentInnerWindowID,
      parentOuter: utilsParent.outerWindowID,
      parentInner: utilsParent.currentInnerWindowID,
      parentUrl:   win.parent.location.href
    };
  }

  if (win.opener) {
    var msgData = {
      __proto__ :  null,
      outer:       utils.outerWindowID,
      visibleInner:utils.currentInnerWindowID,
      parentOuter: WinMap.TopWindowFlag,
      parentInner: WinMap.TopWindowFlag
    };
    var utilsOpener = getDOMUtils(win.opener);
    msgData.openerOuter = utilsOpener.outerWindowID;
    return msgData;
  }

  return {
    __proto__ :  null,
    outer:       utils.outerWindowID,
    visibleInner:utils.currentInnerWindowID,
    parentOuter: WinMap.TopWindowFlag,
    parentInner: WinMap.TopWindowFlag
  };
}
