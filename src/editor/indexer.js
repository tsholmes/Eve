import macros from "../macros.sjs";

var _ = require("lodash");
_.mixin(require("lodash-deep"));

var helpers = require("./helpers");

//---------------------------------------------------------
// Indexer
//---------------------------------------------------------

function Indexer(program, handlers) {
  this.worker = program.worker
  this.system = program.system;
  this.indexes = {};
  this.aliases = {}
  this.tablesToForward = [];
  this.handlers = handlers || {};
  this.latestDiffs = {};
};
module.exports.Indexer = Indexer;

Indexer.prototype = {
  // Diff handling
  handleDiffs: function(diffs, fromProgram) {
    this.latestDiffs = diffs;
    var indexes = this.indexes;
    var system = this.system;
    var cur;
    var specialDiffs = ["view", "field"];
    var isSpecial = false;
    foreach(table of specialDiffs) {
      if(!diffs[table] || !(diffs[table].adds || diffs[table].removes)) { continue; }
      applyDiff(system, table, diffs[table]);
      isSpecial = true;
    }

    if(isSpecial) {
      var viewsToClear = getNonInputWorkspaceViews();

      // Nuke indexes before the system nukes facts.
      foreach(table of viewsToClear) {
        if(!this.indexes[table]) { continue; }
        var diff = {adds: [], removes: this.facts(table)};
        forattr(type, index of this.indexes[table]) {
          if(!index) { continue; }
          index.index = index.indexer(index.index, diff);
        }
      }

      system.recompile();
      //all non-input views were just cleared, make sure the worker clears storage
      //so that we end up with the views getting repopulated correctly.
      this.worker.postMessage({type: "clearStorage", views: viewsToClear})
    }

    forattr(table, diff of diffs) {
      if(this.indexes[table]) {
        forattr(type, index of this.indexes[table]) {
          index.index = index.indexer(index.index, diff);
        }
      }
      if(specialDiffs.indexOf(table) !== -1) { continue; }
      applyDiff(system, table, diff);
    }

    //we should only forward diffs to the program if they weren't
    //from the program to bgin with.
    if(!fromProgram) {
      var toSend = {};
      foreach(table of this.tablesToForward) {
        if(!diffs[table]) continue;
        toSend[table] = diffs[table];
      }
      if(Object.keys(toSend).length) {
        this.worker.postMessage({type: "diffs", diffs: toSend});
      }
    }

    //if we forced a recompile, we shouldn't redraw until the worker comes back
    //with the latest diffs.
    if(!isSpecial && this.handlers.diffsHandled) {
      this.handlers.diffsHandled(diffs);
    }
  },
  forward: function(table) {
    if(!table) { return; }
    else if(typeof table === "object" && table.length) {
      this.tablesToForward.push.apply(this.tablesToForward, table);
    } else {
      this.tablesToForward.push(table);
    }
  },
  unforward: function(table) {
    var ix = this.tablesToForward.indexOf(table);
    if(ix !== -1) {
      this.tablesToForward.splice(ix, 1);
    }
  },
  currentlyDiffing: function(tableOrTables) {
    var tables = tableOrTables;
    if(tableOrTables.constructor !== Array) {
      tables = [tableOrTables]
    }
    foreach(table of tables) {
      var diff = this.latestDiffs[table];
      if(diff && (diff.adds || diff.removes)) {
        return true;
      }
    }
    return false;
  },

  // Fact retrieval
  facts: function(table) {
    return this.system.getStore(table).getFacts();
  },
  first: function(table) {
    return this.facts(table)[0];
  },
  last: function(table) {
    var facts = this.facts(table);
    return facts[facts.length - 1];
  },

  // Indexing
  addIndex: function(table, kind, keys) {
    var makeIndexer = IndexMakers[kind];
    if(!makeIndexer) {
      throw new Error("Unknown indexer of kind: '" + kind + "'.");
    }
    var indexer = makeIndexer(keys);
    _.deepSet(this.indexes, [table, indexer.type], {
      //initialize the index by sending an add of all the facts we have now.
      index: indexer(null, {adds: this.facts(table), removes: []}),
      indexer: indexer
    });
    return this.indexes[table][indexer.type];
  },
  removeIndex: function(table, kind, keys) {
    var type = toIndexType(kind, keys);
    var tableIndexes = this.indexes[table];
    if(!tableIndexes) { return; }
    delete tableIndexes[type];
  },
  addAlias: function(name, table, kind, keys) {
    this.aliases[name] = [table, kind, keys];
  },
  removeAlias: function(name) {
    delete this.aliases[name];
  },
  index: function(table, kind, keys) {
    if(arguments.length === 1) {
      // We are trying to use an alias.
      var name = table;
      if(!this.aliases[name]) {
        throw new Error("Alias: '" + name + "' does not exist.");
      }
      unpackInto [table, kind, keys] = this.aliases[name];
    }
    if(!table || !kind || keys === undefined) {
      throw new Error("Cannot retrieve ambiguous index with table: '" + table + "' kind '" + kind + "' and keys '" + JSON.stringify(keys) + "'.");
    }

    var type = toIndexType(kind, keys);
    var cur = _.deepGet(this.indexes, [table, type]);
    if(!cur) {
      console.info("Generating index for view: '" + table + "' of type: '" + type + "'.");
      cur = this.addIndex(table, kind, keys);
    }
    return cur.index;
  },
  hasIndex: function(table, kind, keys) {
    if(arguments.length === 1) {
      // We are trying to use an alias.
      var name = table;
      if(!this.aliases[name]) {
        throw new Error("Alias: '" + name + "' does not exist.");
      }
      unpackInto [table, kind, keys] = this.aliases[name];
    }
    var type = toIndexType(kind, keys);
    return !!_.deepGet(this.indexes, [table, type]);
  },
};

//---------------------------------------------------------
// Fact Indexers
//---------------------------------------------------------

var IndexMakers = {
  // Builds a lookup table from `keyIx`(es) to `valueIx`. [Fact] -> {[Fact[keyIx1],...,Fact[keyIxN]]: Fact[valueIx]}
  // If valueIx is false, value will be the entire matching fact.
  lookup: function(keyIxes) {
    var fn;
    if(keyIxes.length < 3) {
      // Optimized N=1 case.
      unpack [keyIx, valueIx] = keyIxes;
      fn =  function(cur, diffs) {
        var final = cur || {};
        foreach(remove of diffs.removes) {
          delete final[remove[keyIx]];
        }
        if(valueIx !== false) {
          foreach(add of diffs.adds) {
            final[add[keyIx]] = add[valueIx];
          }
        } else {
          foreach(add of diffs.adds) {
            final[add[keyIx]] = add;
          }
        }
        return final;
      }
    } else {
      // Generic multi-arity case.
      var valueIx = keyIxes.pop();
      fn = function(cur, diffs) {
        var final = cur || {};
        foreach(remove of diffs.removes) {
          var pathKeys = new Array(keyIxes.length);
          foreach(ix, keyIx of keyIxes) {
            pathKeys[ix] = remove[keyIx];
          }
          var lastKey = pathKeys.pop();
          var path = _.deepGet(final, pathKeys);
          if(path) {
            delete path[lastKey];
          }
        }
        foreach(add of diffs.adds) {
          var keys = new Array(keyIxes.length);
          foreach(ix, keyIx of keyIxes) {
            keys[ix] = add[keyIx];
          }
          if(valueIx !== false) {
            _.deepSet(final, keys, add[valueIx]);
          } else {
            _.deepSet(final, keys, add);
          }
        }

        return final;
      }
    }

    fn.type = toIndexType("lookup", keyIxes);
    return fn;
  },
  // Groups facts by specified indexes, in order of hierarchy. [Fact] -> {[Any]: [Fact]|Group}
  collector: function(keyIxes) {
    var fn;
    // Optimized N=1 case.
    if(keyIxes.length === 1) {
      var keyIx = keyIxes[0];
      fn = function(cur, diffs) {
        var final = cur || {};
        foreach(remove of diffs.removes) {
          if(!final[remove[keyIx]]) continue;
          _.remove(final[remove[keyIx]], function(group) {
            return _.isEqual(group, remove);
          });
        }
        foreach(add of diffs.adds) {
          if(!final[add[keyIx]]) {
            final[add[keyIx]] = [];
          }
          final[add[keyIx]].push(add);
        }

        garbageCollectIndex(final);
        return final;
      }
    } else {
      fn = function(cur, diffs) {
        var final = cur || {};
        var keys = new Array(keyIxes.length);
        var group;
        foreach(remove of diffs.removes) {
          foreach(ix, keyIx of keyIxes) {
            keys[ix] = remove[keyIx];
          }
          group = _.deepGet(final, keys);
          if(!group) { continue; }
          _.remove(group, keys, function(c) {
            return _.isEqual(c, remove);
          });

        }
        foreach(add of diffs.adds) {
          foreach(ix, keyIx of keyIxes) {
            keys[ix] = add[keyIx];
          }
          group = _.deepGet(final, keys);
          if(!group) {
            group = [];
            _.deepSet(final, keys, group);
          }
          group.push(add);
        }
        garbageCollectIndex(final);
        return final;
      }
    }

    fn.type = toIndexType("collector", keyIxes);
    return fn;
  },
  // Sorts facts by specified indexes, in order of priority. [Fact] -> [Fact]
  sorter: function(sortIxes) {
    var fn;
    fn =  function(cur, diffs) {
      var final = cur || [];
      foreach(remove of diffs.removes) {
        foreach(ix, item of final) {
          if(arrayEqual(item, remove)) {
            final.splice(ix, 1);
            break;
          }
        }
      }

      // @NOTE: This can be optimized further by presorting adds and maintaining loIx as a sliding window.
      foreach(add of diffs.adds) {
        var loIx = 0;
        var hiIx = final.length;
        foreach(sortIx of sortIxes) {
          for(var ix = loIx; ix < hiIx; ix++) {
            var item = final[ix];
            if(add[sortIx] > item[sortIx]) {
              loIx = ix + 1;
            } else if(add[sortIx] < item[sortIx]) {
              hiIx = ix;
              break;
            }
          }
        }
        final.splice(loIx, 0, add);
      }

      return final;
    }

    fn.type = toIndexType("sorter", sortIxes);
    return fn;
  }
};
module.exports.IndexMakers = IndexMakers;

//---------------------------------------------------------
// Index helpers
//---------------------------------------------------------

function toIndexType(kind, keys) {
  return kind + "<" + keys.join(",") + ">";
}

// Delete any keys or descendant keys which are empty.
function garbageCollectIndex(index) {
  forattr(key, group of index) {
    if(group instanceof Array) {
      if(!group || !group.length) {
        delete index[key];
      }
    } else if(typeof group === "object") {
      garbageCollectIndex(group);
      if(!Object.keys(group).length) {
        delete index[key];
      }
    }
  }
}
module.exports.garbageCollectIndex = garbageCollectIndex;

function hasTag(id, needle) {
  var tags = indexer.index("tag", "collector", [0])[id];
  foreach(tagEntry of tags) {
    unpack [_, tag] = tagEntry;
    if(tag === needle) return true;
  }
  return false;
}
module.exports.hasTag = hasTag;

//List all the tables that the table queries on.
function incomingTables(curTable) {
  var incoming = {};
  var queries = indexer.index("viewToQuery")[curTable];
  var queryToConstraint = indexer.index("queryToViewConstraint");
  var queryToAggregate = indexer.index("queryToAggregateConstraint");
  var constraints;
  foreach(query of queries) {
    constraints = queryToConstraint[query[0]];
    foreach(constraint of constraints) {
      incoming[constraint[2]] = true;
    }
    aggregates = queryToAggregate[query[0]];
    foreach(agg of aggregates) {
      incoming[agg[3]] = true;
    }
  }
  return Object.keys(incoming);
}
module.exports.incomingTables = incomingTables;

// List all the tables that query on this table.
function outgoingTables(curTable) {
  //@TODO
}
module.exports.outgoingTables = outgoingTables;

// List all derived workspace views.
function getNonInputWorkspaceViews() {
  var final = [];
  var views = indexer.facts("workspaceView");
  foreach(view of views) {
    if(!hasTag(view[0], "input")) {
      final.push(view[0]);
    }
  }
  return final;
}
module.exports.getNonInputWorkspaceViews = getNonInputWorkspaceViews;

// List the positions and sizes of each tile currently in the grid.
function getTileFootprints() {
  return indexer.facts("gridTile").map(function(cur, ix) {
    unpack [tile, type, w, h, x, y] = cur;
    return {pos: [x, y], size: [w, h]};
  });
}
module.exports.getTileFootprints = getTileFootprints;

function sortByIx(facts, ix) {
  return facts.sort(function(a, b) {
    return a[ix] - b[ix];
  });
};
module.exports.sortByIx = sortByIx;

//---------------------------------------------------------
// Diff helpers
//---------------------------------------------------------
var _dependencies = {
  view: {
    field: [0, 1],
    query: [0, 1],
    tag: [0, 0]
  },
  field: {
    aggregateConstraint: [0, 2],
    constantConstraint: [0, 1],
    displayName: [0, 0],
    functionConstraint: [0, 2],
    tag: [0, 0],
    viewConstraint: [0, 2]
  },
  query: {
    aggregateConstraint: [0, 1],
    constantConstraint: [0, 0],
    functionConstraint: [0, 1],
    tag: [0, 0],
    viewConstraint: [0, 1]
  },
  aggregateConstraint: {
    aggregateConstraintAggregateInput: [0, 0],
    aggregateConstraintBinding: [0, 0],
    aggregateConstraintSolverInput: [0, 0],
    tag: [0, 0]
  },
  functionConstraint: {
    functionConstraintInput: [0, 0],
    tag: [0, 0]
  },
  viewConstraint: {
    viewConstraintBinding: [0, 0],
    tag: [0, 0]
  }
};

var diff = {
// Remove fact from view, including all known dependencies.
  remove: function remove(view, fact) {
    return diff.removeAll(view, [fact]);
  },
  removeAll: function removeAll(view, facts, indent) {
    indent = indent || 0;
    var diff = {};
    if(!facts) { return diff; }
    foreach(fact of facts) {
      if(!fact) { continue; }
      if(!diff[view]) {
        diff[view] = {adds: [], removes: []};
      }
      diff[view].removes.push(fact);
      var deps = _dependencies[view];
      // console.log(new Array(indent + 1).join("> "), "Removing '" + view + "':", fact, "---");
      // console.log(new Array(indent + 2).join("  "), "X", view, diff[view]);
      if(!deps) { continue; }

      forattr(dep, keys of deps) {
        unpack [fromIx, toIx] = keys;
        var depFacts = indexer.index(dep, "collector", [toIx])[fact[fromIx]] || []; //_collect(dep, toIx, fact[fromIx]);
        // console.log(new Array(indent + 2).join("  "), view, "<--", dep, "@", keys, ":", depFacts);
        helpers.merge(diff, removeAll(dep, depFacts, indent + 1));
      }
    }
    return diff;
  }
}
module.exports.diff = diff;
