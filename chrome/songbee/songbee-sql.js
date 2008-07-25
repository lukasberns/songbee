var schemaVersion = 2;
var dserv = Components.classes["@mozilla.org/file/directory_service;1"] 
                     .getService(Components.interfaces.nsIProperties);

var file = dserv.get("ProfD", Components.interfaces.nsIFile);
file.append("workship.db");

var ours = dserv.get("resource:app", Components.interfaces.nsIFile);
ours.append("chrome");
ours.append("workship.db");
if (!file.exists()) {
    if (!ours.exists()) { alert("Oops, I can't find my own database in "+ours.path) }
    ours.copyTo(dserv.get("ProfD", Components.interfaces.nsIFile), "workship.db");
}

var storageService = Components.classes["@mozilla.org/storage/service;1"]
                        .getService(Components.interfaces.mozIStorageService);

var mDBConn = storageService.openDatabase(file);

/* Songbee 2 SQLite Schema

songbee_system : schema_version
play_item : id, playlist, song, position, type, data
playlist     : id, name, css
song          : id, song_key, title, first_line, xml, age, playcount

*/

// Various functions to upgrade the schema on changes
if (schema_version() < 2) {
	alert("Upgrading Songbee database to version 2.0");
	doSQLStatement("CREATE TABLE IF NOT EXISTS songbee_system (schema_version)");
	doSQLStatement("INSERT INTO songbee_system (schema_version) VALUES (2.0)");
	doSQLStatement("ALTER TABLE play_item ADD COLUMN type");
	doSQLStatement("UPDATE play_item SET type='song'");
	doSQLStatement("ALTER TABLE play_item ADD COLUMN data");
	doSQLStatement("ALTER TABLE playlist ADD COLUMN css");
	
}

function schema_version () { 
	try {
		var statement = mDBConn.createStatement("SELECT schema_version FROM songbee_system");
		statement.executeStep();
		return statement.getString(0);
	} catch (e) { return 1 }
}

function jsdump(str)
{
  Components.classes['@mozilla.org/consoleservice;1']
            .getService(Components.interfaces.nsIConsoleService)
            .logStringMessage(str);
}

function databaseClass (where, table, cols) {
    where.prototype.init = function (values) {
        var that = this;
        values.forEach(function (e,i) { that["_"+that.columns[i]] = e});
    };
    where.prototype.table = table;
    where.prototype.columns = cols;

    // Make accessors
    cols.forEach(function (e) { 
        where.prototype[e] = function (val) { 
            if (val) this.set(e, val);
            return this["_"+e];
        }
    });

    where.prototype.select_clause = "SELECT "+cols.join(", ")+" FROM "+table; 
    where.retrieveAll = function (callback)  {
        return doSQL(this.prototype.select_clause, this, callback)
    }
    where.retrieve = function (id)  {
        var a = doSQL(this.prototype.select_clause + " WHERE id = "+id, this);
        if (a) { return a[0] }
    }
    // delete was a reserved word in JS 1.5
    where.prototype.drop = function ()  {
        if (this.tidy_up) { this.tidy_up() } 
        doSQLStatement("DELETE FROM "+table+" WHERE id="+this.id());
    }
    where.prototype.set = function (name, val) {
        doSQLStatement("UPDATE "+table+" SET "+name+" = (?1) WHERE id="+this.id(), [val]);
        this["_"+name] = val;
    }

    where.create = function (myA) {
        var cols = new Array(); var values = new Array();
        while (myA.length >0) { cols.push(myA.shift()); values.push(myA.shift()) }
        var cc = "INSERT INTO "+table+" ("+cols.join(", ")+") VALUES (";
        for (var i=1;  i <= cols.length; i++) { cc += "(?"+i+"), "; }
        cc = cc.replace(/, $/, ")");
        doSQLStatement(cc, values);
        return where.retrieve(auto_increment_value());
    }
};

function doSQL(sql, targetClass, callback, params) {
    var rv = new Array;
    var statement;
    try {
        statement = mDBConn.createStatement(sql);
    } catch (e) {
        jsdump("Bad SQL: "+sql);
        return;
    }
    if (params) {
        for (var i =0; i < params.length; i++) 
            statement.bindStringParameter(i, params[i]);
    }
    while (statement.executeStep()) {
        var c;
        var thisArray = new Array;
        for (c=0; c< statement.numEntries; c++) {
            thisArray.push(statement.getString(c));
        }
        if (targetClass) {
            var thing = new targetClass(thisArray);
            for(var i=0; i < thing.columns.length; i++)
                thing["_"+thing.columns[i]] = thisArray[i];
            if (callback) { callback(thing) } 
            rv.push(thing)
        } else { rv.push(thisArray) } 
    }
    return rv;
}

function doSQLStatement(sql, params) {
    var statement;
	try	{ statement = mDBConn.createStatement(sql); } catch (e) { alert("SQL setup failed: "+sql); }
    if (params) {
        for (var i =0; i < params.length; i++) 
            statement.bindStringParameter(i, params[i]);
    }
    statement.execute();
}

function auto_increment_value () { 
    var statement = mDBConn.createStatement("SELECT last_insert_rowid()");
    statement.executeStep();
    return statement.getInt32(0);
}

function Playlist () {}; databaseClass(Playlist, "playlist", [ "id", "name", "css" ]);
function PlayItem () {}; databaseClass(PlayItem, "play_item", [ "id", "playlist", "song", "position", "type", "data" ]);
function Song () {}; databaseClass(Song, "song", [ "id", "song_key", "title", "first_line", "xml", "age", "playcount" ]);

Song.ageAll = function () {
    doSQLStatement("UPDATE song SET age = 0 WHERE age IS NULL");
    doSQLStatement("UPDATE song SET age = age + 1");
}

Song.prototype.played = function () {
    doSQLStatement("UPDATE song SET playcount = 0 WHERE playcount IS NULL");
    doSQLStatement("UPDATE song SET playcount = playcount + 1 WHERE id = "+this.id());
}

Song.prototype.xmlDOM = function () {
    var parsed = (new DOMParser()).parseFromString(this.xml(), "text/xml");
    return parsed;
};

Playlist.prototype.items = function (callback) {
    return doSQL("SELECT id, playlist, song, position, type, data FROM play_item WHERE play_item.playlist = "+this._id+" ORDER BY position ", PlayItem, function (pi) { pi.specialize(); if (callback) callback(pi); });
};

Playlist.prototype.tidy_up = function () {
    doSQLStatement("DELETE FROM play_item WHERE playlist= (?1)", [this._id]);
};

Playlist.prototype.add_item = function(song, position, type, data) {
	if (!type) type = "song";
	if (!data) data = "";
	if (type == "song" && !song) { alert("Bug: No song ID given for song item."); return; }
    doSQLStatement("INSERT INTO play_item (playlist, song, position, type, data) VALUES ((?1), (?2), (?3),(?4),(?5))", [this._id, song, position, type, data]);
};

PlayItem.prototype.song = function() {
	if (this.type() != "song") { alert("Bug: song called on playitem "+this._id+" which has type ["+this.type+"]"); }
	var songlist = doSQL("SELECT song.id, song_key, title, first_line, xml FROM song  WHERE id = "+this._song, Song);
	if (songlist.length < 1 )  { alert("Retrieving song not in database: has it been deleted?"); }
	return songlist[0]
}

/* PlayItem function dispatchers. We are faking specialization here. */

var PlayItemDispatchers = {
	transformToHTML: {
		song: function (stylesheet, doc) { return transformDOM(this.song().xmlDOM(), stylesheet, doc) },
		fallback: function () { return "<p>[Don't know how to transform object of type "+this.type+"]</p>" }
	},
	postDisplayHook: {
		song: function () { return this.song().played() },
		fallback: function () {}
	},
	title: {
		song: function () { return this.song().title() },
		fallback: function() { return "[PlayItem "+this._id+"/"+this.type()+"]" }
	}
};

PlayItem.prototype.specialize = function () {
	for (var handle in PlayItemDispatchers) {
		this[handle] = PlayItemDispatchers[handle][this.type()] || PlayItemDispatchers[handle]["fallback"];
	}
}
