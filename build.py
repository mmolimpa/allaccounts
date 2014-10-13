#!/usr/bin/python
# -*- coding: utf-8 -*-

# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import build_tools
import sys

if len(sys.argv) > 1:
    changeset = sys.argv[1]
else:
    changeset = None

b = build_tools.BuildExtension("src", "build")

b.add_binary("icon.png")
b.add_binary("content/favicon.ico")

b.add_text("install.rdf")
b.add_text("chrome.manifest")
#b.add_text("bootstrap.js")
b.add_text("components/protocol.js")

b.add_text("content/content-injection.js")
#b.add_text("content/content-injection-reset.js")

b.add_text("modules/main.js")
b.add_text("modules/error.js")
b.add_text("modules/popup.js")
b.add_text("modules/welcome.js")
b.add_text("modules/maintenance.js")
b.add_text("modules/remote-browser.js")


b.add_locale("en-US")
#b.add_locale("pt-BR")
#b.add_locale("es-ES")


b.add_text("locale/${locale}/general.properties")
b.add_text("locale/${locale}/about.properties")
b.add_text("locale/${locale}/welcome.properties")

b.set_var("EXT_VERSION", "2.1alpha3pre")
verEx = build_tools.getVersionedString(changeset, b.get_var("EXT_VERSION"))

if changeset == None:
    b.set_var("SOURCE_URL", "https://github.com/hultmann/allaccounts/tree/master/src")
    b.set_var("EXT_VERSION", verEx)
else:
    b.set_var("SOURCE_URL", "https://github.com/hultmann/allaccounts/tree/" + changeset)


b.set_var("EXT_ID",          "{42f25d10-4944-11e2-96c0-0b6a95a8daf0}")
b.set_var("EXT_NAME",        "AllAccounts (Formerly Multifox 2 BETA)")
b.set_var("EXT_SITE",        "http://br.mozdev.org/multifox/all.html#allaccounts")
b.set_var("APP_MIN_VERSION", "28.0")
b.set_var("APP_MAX_VERSION", "31.*")
b.set_var("CHROME_NAME",     "allaccounts")
b.set_var("EXT_HOST",        "allaccounts-" + verEx)
b.set_var("BASE_DOM_ID",     "allaccounts")

b.set_var("PATH_CONTENT",    "chrome://"   + b.get_var("EXT_HOST") + "/content")
b.set_var("PATH_LOCALE",     "chrome://"   + b.get_var("EXT_HOST") + "/locale")
b.set_var("PATH_MODULE",     "resource://" + b.get_var("EXT_HOST"))

b.set_var("PERSIST_TAB_LOGINS",              "multifox-tab-logins");
b.set_var("INTERNAL_DOMAIN_SUFFIX_LOGGEDIN", "multifox-auth-2")
b.set_var("INTERNAL_DOMAIN_SUFFIX_ANON",     "multifox-anon-2") #external anon 3party

xpi = b.get_var("CHROME_NAME") + "-" + b.get_var("EXT_VERSION")
b.copy_files()

# AMO
b.set_var("UPDATE_DATA", "")
b.build_xpi(xpi + "-amo.xpi")

# website
b.set_var("UPDATE_DATA", (
"    <em:updateURL><![CDATA[http://br.mozdev.org/multifox/update.html"
       "?reqVersion=%REQ_VERSION%"
       "&extId=%ITEM_ID%"
       "&extVersion=%ITEM_VERSION%"
       "&extMaxappversion=%ITEM_MAXAPPVERSION%"
       "&extStatus=%ITEM_STATUS%"
       "&appId=%APP_ID%"
       "&appVersion=%APP_VERSION%"
       "&appOs=%APP_OS%"
       "&appAbi=%APP_ABI%"
       "&appLocale=%APP_LOCALE%]]>"
    "</em:updateURL>\n"
"    <em:updateKey>\n"
"      MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDeQmBgnA27cxcxXMlSA4QGaY41UKOXi8Ps\n"
"      J6IitDvvXsp9ZTzjdwDIdvJ7oB9dyycXlHZL9tKcatOwhXbUN0jt28hv8sYGxlj2oxIt5sOQ\n"
"      C0q/P2KHU5OAHMl/eRJIe8QINCBGI5CEr84ArnhJ7g+DYOFQfVtop3sNBYI78nEQ2wIDAQAB\n"
"    </em:updateKey>\n"))
b.build_xpi(xpi + ".xpi")
b.create_update_rdf(xpi + ".xpi")
