import macros from "../macros.sjs";

var _ = require("lodash");
var helpers = require("./helpers");
var grid = require("./grid");
var ui = require("./ui");

//---------------------------------------------------------
// Globals
//---------------------------------------------------------

var ide = module.exports;
var indexer;
var aggregateFuncs = ["sum", "count", "avg", "maxBy"];

function parseValue(value) {
  //if there are non-numerics then it can't be a number
  if(value.match(new RegExp("[^\\d\\.-]"))) {
    return value;
  } else if(value.indexOf(".")) {
    //it's a float
    return parseFloat(value);
  }
  return parseInt(value);
}

//---------------------------------------------------------
// Dispatcher
//---------------------------------------------------------

function maxRowId(view) {
  var ids = indexer.index("editId", "collector", [0])[view];
  if(ids && ids.length) {
    return ids[ids.length - 1][2];
  } else {
    return -1;
  }
}

function sortView(view) {
  var oldFields = indexer.index("field", "collector", [1])[view].slice();
  var fields = helpers.cloneArray(oldFields);
  var oldFacts = indexer.facts(view).slice();
  var facts = helpers.cloneArray(oldFacts);

  // Splits fields into grouped and ungrouped.
  var groups = [];
  var rest = [];
  fields = _.sortBy(fields, 2);
  foreach(field of fields) {
    if(indexer.hasTag(field[0], "grouped")) {
      groups.push(field);
    } else {
      rest.push(field);
    }
  }
  fields = groups.concat(rest);

  // Updates field ixes and reorders facts if changed.
  var modified = false;
  foreach(ix, field of fields) {
    if(field[2] === ix) { continue; }
    modified = true;
    foreach(factIx, fact of oldFacts) {
      facts[factIx][ix] = fact[field[2]];
    }
    field[2] = ix;
  }

  if(modified) {
    var diff = {
      field: {adds: fields, removes: oldFields},
    };
    diff[view] = {adds: facts, removes: oldFacts};
    indexer.handleDiffs(diff);
  }
}

function _clearFilter(field) {
  var diff = {};
  var view = indexer.index("field", "lookup", [0, 1])[field];
  var queries = indexer.index("query", "collector", [1])[view];
  var functionConstraints = [];
  foreach(queryFact of queries) {
    functionConstraints.push.apply(functionConstraints, indexer.index("functionConstraint", "collector", [1])[queryFact[0]]);
  }
  foreach(constraint of functionConstraints) {
    if(!indexer.hasTag(constraint[0], "filter") || !indexer.hasTag(constraint[0], field)) { continue; }
    var field = constraint[2];
    var fieldFact = indexer.index("field", "lookup", [0, false])[field];
    helpers.merge(diff, indexer.removeDiff("field", fieldFact));
  }
  var constantConstraints = indexer.index("constantConstraint", "collector", [1])[field];
  foreach(constraint of constantConstraints) {
    helpers.merge(diff, indexer.removeDiff("constantConstraint", constraint));
  }

  return diff;
}

function updateRow(table, neue, old) {
  var diff = {};
  var oldFact = JSON.stringify(old);
  var newFact = JSON.stringify(neue);
  var edits = indexer.index("editId", "lookup", [0, 1, 2])[table];
  var editId;
  if(edits && edits[oldFact] !== undefined && edits[oldFact] !== null) {
    editId = edits[oldFact];
  } else {
    // Hack-around until every constant row has a *saved* editId.
    editId = maxRowId(table) + 1;
  }

  diff[table] = {adds: [neue], removes: [old]};
  diff["editId"] = {adds: [[table, newFact, editId]], removes: [[table, oldFact, editId]]};
  return diff;
}

function dispatch(eventInfo) {
  unpack [event, info] = eventInfo;

  switch(event) {
    case "diffsHandled":
      //TODO: Should we push this off to a requestAnimationFrame?
      console.time("render");
      ui.render();
      console.timeEnd("render");
      break;

    case "locationChange":
      var activeGrid = indexer.getActiveGrid();
      var target = info.state.grid || "default";
      var pos = info.state.pos;
      var diff = {activeGrid: {adds: [[target]], removes: [[activeGrid]]}};
      console.log(info.state);
      ui.animation.start("gridIn", {target: target, pos: pos}, function() {
        indexer.handleDiffs(diff);
      });
      break;

    //---------------------------------------------------------
    // Tiles
    //---------------------------------------------------------
    case "setActivePosition":
      var diff = {};
      diff["activePosition"] = {adds: [info], removes: indexer.facts("activePosition")};
      indexer.handleDiffs(diff);
      break;

    case "selectTile":
      var diff = {};
      diff["activeTile"] = {adds: [[info]], removes: indexer.facts("activeTile")};
      indexer.handleDiffs(diff);
      break;

    case "deselectTile":
      var diff = {};
      diff["activeTile"] = {adds: [], removes: indexer.facts("activeTile")};
      indexer.handleDiffs(diff);
      break;

    case "enterTile":
      var target = indexer.index("tileTarget", "lookup", [0, 1])[info];
      if(!target) { break; }
      var tile = indexer.index("gridTile", "lookup", [0, false])[info];
      unpack [__, __, __, __, __, x, y] = tile;
      var pos = [x, y];
      console.info("Entering tile", info, "->", target);
      if(target.indexOf("grid://") !== 0) {
        // @FIXME: Support for generic links.
        break;
      }
      var activeGrid = indexer.getActiveGrid();
      var fragment = "#" + target.substring(7);
      window.history.replaceState({grid: activeGrid, pos: pos}, "", "#" + (activeGrid === "default" ? "" : activeGrid));
      window.history.pushState({grid: target, pos: pos}, "", fragment);
      var diff = {activeGrid: {adds: [[target]], removes: [[activeGrid]]}};
      ui.animation.start("gridOut", {target: target, pos: pos}, function() {
        indexer.handleDiffs(diff);
      });
      break;

    case "addView":
      var id = global.uuid();
      var diff = {
        view: {adds: [[id]], removes: []},
        workspaceView: {adds: [[id]], removes: []},
        displayName: {adds: [[id, info.name || "Untitled table"]], removes: []}
      };
      if(info.type === "constant") {
        diff.isInput = {adds: [[id]], removes: []};
        diff.tag = {adds: [[id, "input"], [id, "constant"]], removes: []};
      }
      indexer.handleDiffs(diff);
      indexer.forward(id);
      return id;
      break;

    case "addTile":
      var id = info.id;
      var tileId = global.uuid();
      var activeGrid = indexer.getActiveGrid();
      if(!info.pos) {
        info.pos = grid.firstGap(ui.tileGrid, indexer.getTiles(), ui.defaultSize);
        if(!info.pos) {
          console.warn("Grid is full, aborting.");
          break;
        }
      }
      unpack [x, y] = info.pos;
      unpack [w, h] = info.size;
      var gridUrl = "grid://" + tileId;
      var gridTileId = global.uuid();
      var diff = {
        tableTile: {adds: [[tileId, id], [gridTileId, id]], removes: []},
        gridTile: {adds: [
          [tileId, activeGrid, info.type, w, h, x, y],
          [gridTileId, gridUrl, info.type, 12, 12, 0, 0]
        ], removes: []},
        tileTarget: {adds: [[tileId, gridUrl]], removes: []},
        activePosition: {adds: [], removes: indexer.facts("activePosition")}
      };
      indexer.handleDiffs(diff);
      return tileId;
      break;

    case "closeTile":
      var tileId = info;
      var tableId = indexer.index("tableTile", "lookup", [0, 1])[tileId];
      var diff = {
        gridTile: {adds: [], removes: [indexer.index("gridTile", "lookup", [0, false])[tileId]]},
        tableTile: {adds: [], removes: [indexer.index("tableTile", "lookup", [0, false])[tileId]]},
        workspaceView: {adds: [], removes: [tableId]}
      };
      indexer.handleDiffs(diff);
      indexer.unforward(tableId);
      break;

    //---------------------------------------------------------
    // Menu actions
    //---------------------------------------------------------

    case "addTableTile":
      var id = dispatch(["addView", {type: "constant"}]);
      var activePosition = indexer.first("activePosition");
      if(activePosition) {
        unpack [width, height, x, y] = activePosition;
        dispatch(["addTile", {pos: [x, y], size: [width, height], type: "table", id: id}]);
      } else {
        dispatch(["addTile", {type: "table", id: id}]);
      }
      dispatch(["clearContextMenu"]);
      break;

    case "addViewTile":
      var id = dispatch(["addView", {name: "Untitled view"}]);
      var activePosition = indexer.first("activePosition");
      if(activePosition) {
        unpack [width, height, x, y] = activePosition;
        dispatch(["addTile", {pos: [x, y], size: [width, height], type: "table", id: id}]);
      } else {
        dispatch(["addTile", {type: "table", id: id}]);
      }
      dispatch(["clearContextMenu"]);
      // add an initial query
      var queryId = global.uuid();
      var diff = {
        query: {adds: [[queryId, id, 0]], removes: []}
      }
      indexer.handleDiffs(diff);
      break;

    case "openView":
      unpack [tableId, name] = info.selected;
      var diff = {
        workspaceView: {adds: [[tableId]], removes: []}
      };
      indexer.handleDiffs(diff);
      if(indexer.hasTag(tableId, "constant")) {
        indexer.forward(tableId);
      }
      var activePosition = indexer.first("activePosition");
      if(activePosition) {
        unpack [width, height, x, y] = activePosition;
        dispatch(["addTile", {pos: [x, y], size: [width, height], type: "table", id: tableId}]);
      } else {
        dispatch(["addTile", {size: ui.defaultSize, type: "table", id: tableId}]);
      }
      dispatch(["clearContextMenu"]);
      break;

    case "addTableToView":
      unpack [tableId, tableName] = info.selected;
      unpack [queryId, view, ix] = indexer.index("query", "collector", [1])[info.id][0];
      var currentFields = indexer.index("field", "collector", [1])[info.id];
      var currentFieldCount = 0;
      if(currentFields) {
        currentFieldCount = currentFields.length;
      }
      var constraintId = global.uuid();
      var tableFields = indexer.index("field", "collector", [1])[tableId];
      var displayNameLookup = indexer.index("displayName", "lookup", [0, 1]);
      var newFields = [];
      var bindings = [];
      var displayNames = [];
      foreach(ix, field of tableFields) {
        var fieldId = global.uuid();
        //generate fields for each field in the added view
        newFields.push([fieldId, info.id, ix + currentFieldCount]);
        //use their displayName
        displayNames.push([fieldId, displayNameLookup[field[0]]]);
        //generate view constraint bindings for each of those fields
        bindings.push([constraintId, fieldId, field[0]]);
      }
      var diff = {
        field: {adds: newFields, removes: []},
        displayName: {adds: displayNames, removes: []},
        viewConstraint: {adds: [[constraintId, queryId, tableId, false]], removes: []},
        viewConstraintBinding: {adds: bindings, removes: []}
      }
      indexer.handleDiffs(diff);
      dispatch(["clearContextMenu"]);
      break;

    //---------------------------------------------------------
    // Tables
    //---------------------------------------------------------
    case "addRow":
      var diff = {};
      diff[info.table] = {adds: [info.row], removes: []};
      var id = maxRowId(info.table) + 1;
      if(id) { id += 1; }
      diff["editId"] = {adds: [[info.table, JSON.stringify(info.row), id]], removes: []};
      indexer.handleDiffs(diff);
      break;

    case "updateRow":
      var diff = updateRow(info.table, info.newRow, info.oldRow);
      indexer.handleDiffs(diff);
      break;

    case "updateRows":
      var diff = {};
      foreach(ix, newRow of info.newRows) {
        helpers.merge(diff, updateRow(info.table, newRow, info.oldRows[ix]));
      }
      indexer.handleDiffs(diff);
      break;

    case "addField":
      var diff = {};
      var id = global.uuid();
      var isConstant = indexer.hasTag(info.view, "constant");
      var fields = indexer.index("field", "collector", [1])[info.view] || [];

      //if this is a constant view, patch up the facts that already
      //exist for the view
      if(isConstant) {
        var oldFacts = (indexer.facts(info.view) || []).slice();
        var newFacts = new Array(oldFacts.length);
        foreach(ix, fact of oldFacts) {
          var newFact = fact.slice();
          newFact.push("");
          newFacts[ix] = newFact;
        };
        diff[info.view] = {adds: newFacts, removes: oldFacts};
      } else {
        //if this isn't a constant view, then we need to fill this field with
        //something. @TODO: should this be a constant? should we do this some
        //other way?
        //@TODO: we can't assume there's only ever one query...
        unpack [queryId] = indexer.index("query", "collector", [1])[info.view][0];
        diff.constantConstraint = {adds: [[queryId, id, ""]], removes: []};
        diff.tag = {adds: [[id, "calculated"]], removes: []};
      }

      diff.field = {adds: [[id, info.view, fields.length]], removes: []};
      diff.displayName = {adds: [[id, info.name]], removes: []};
      indexer.handleDiffs(diff);
      break;

    case "addFieldToView":
      var diff = {};
      var addedTable = info.table;
      var addedField = info.field;
      var currentTable = info.current;
      var query = indexer.index("query", "collector", [1])[currentTable];
      if(!query || !query.length) return;
      var queryId = query[0][0];
      var viewConstraints = indexer.index("viewConstraint", "collector", [1])[queryId];
      var viewConstraintId;
      foreach(vc of viewConstraints) {
        unpack [vcId, __, sourceView, isNegated] = vc;
        if(sourceView === addedTable) {
          viewConstraintId = vcId;
        }
      }
      if(!viewConstraintId) {
        viewConstraintId = global.uuid();
        diff.viewConstraint = {adds: [[viewConstraintId, queryId, addedTable, false]], removes: []};
      }

      var fieldIx = indexer.index("field", "collector", [1])[currentTable] ? indexer.index("field", "collector", [1])[currentTable].length : 0;
      var fieldId = global.uuid();
      var name = indexer.index("displayName", "lookup", [0, 1])[addedField] || "";
      diff.field = {adds: [[fieldId, currentTable, fieldIx]], removes: []};
      diff.displayName = {adds: [[fieldId, name]], removes: []};
      diff.viewConstraintBinding = {adds: [[viewConstraintId, fieldId, addedField]], removes: []};
      indexer.handleDiffs(diff);
      break;

    case "dragField":
      var table = info.table;
      var field = info.field;
      var diff = {
        "dragField": {adds: [[table, field]], removes: indexer.facts("dragField")}
      };
      indexer.handleDiffs(diff);
      break;

    case "clearDragField":
      var diff = {
        "dragField": {adds: [], removes: indexer.facts("dragField")}
      };
      indexer.handleDiffs(diff);
      break;

    case "dropField":
      var table = info.table;
      var field = info.field;
      var diff = {
        "dragField": {adds: [], removes: indexer.facts("dragField")},
        "dropField": {adds: [[table, field]], removes: indexer.facts("dropField")}
      };
      indexer.handleDiffs(diff);
      break;

    case "groupField":
      var view = indexer.index("field", "lookup", [0, 1])[info];
      var diff = {
        tag: {adds: [[info, "grouped"]], removes: []}
      };
      indexer.handleDiffs(diff);
      sortView(view);
      break;

    case "ungroupField":
      var view = indexer.index("field", "lookup", [0, 1])[info];
      var diff = {
        tag: {adds: [], removes: [[info, "grouped"]]}
      }
      indexer.handleDiffs(diff);
      sortView(view);
      break;

    case "joinField":
      var field1 = info.id;
      var field2 = info.selected[0];

      var bindings = indexer.index("viewConstraintBinding", "collector", [1])[field2];
      if(!bindings || !bindings.length) {
        throw new Error("Cannot join with unbound (local?) field: '" + indexer.index("displayName", "lookup", [0, 1])[field2] + "'.");
      }
      var binding = bindings[0];
      unpack [constraint, __, sourceField] = binding;
      // @TODO: check for flipped duplicates?
      // var bindings = indexer.index("viewConstraintBinding", "collector", [0])[constraint] || [];

      indexer.handleDiffs({
        "viewConstraintBinding": {adds: [[constraint, field1, sourceField]], removes: []},
        "tag": {adds: [[field2, "hidden"]], removes: []},
        "join": {adds: [[field1, sourceField]], removes: []}
      });
      dispatch(["clearContextMenu"]);
      break;

    case "unjoinField":
      var joins = indexer.index("join", "collector", [0])[info];
      var bindings = indexer.index("viewConstraintBinding", "collector", [1])[info];
      var diff = {
        join: {adds: [], removes: joins},
        tag: {adds: [], removes: []},
        viewConstraintBinding: {adds: [], removes: []}
      };
      foreach(join of joins) {
        unpack [field, sourceField] = join;
        // Remove the viewConstraintBinding
        foreach(binding of bindings) {
          unpack [constraint, __, bindingSource] = binding;
          if(bindingSource === sourceField) {
            diff.viewConstraintBinding.removes.push(binding);

            // Reveal any fields which were collapsed into this one by the join.
            var relatedBindings = indexer.index("viewConstraintBinding", "collector", [0])[constraint];
            foreach(related of relatedBindings) {
              unpack [__, relatedField, __] = related;
              diff.tag.removes.push([relatedField, "hidden"]);
            }
          }
        }
      }
      indexer.handleDiffs(diff);
      break;

    case "filterField":
      var clearDiff = _clearFilter(info.id);
      var diff = {};
      if(!info.text) { return indexer.handleDiffs(clearDiff); }
      var view = indexer.index("field", "lookup", [0, 1])[info.id];
      var viewFields = indexer.index("field", "collector", [1])[view];
      var queries = indexer.index("query", "collector", [1])[view];
      if(!queries || !queries.length) {
        throw new Error("cannot filter malformed view: '" + view + "' containing field: '" + info.id + "'.");
      }
      var query = queries[0][0]; // @FIXME: Handle multiple queries.

      if(info.text[0] === "=") {
        // This is a function filter.
        var code = info.text.substring(1);
        var id = global.uuid();
        var filterField = global.uuid();
        var displayNames = indexer.index("displayName", "lookup", [0, 1]);
        var namedFields = viewFields.map(function(cur) {
          return [cur[0], displayNames[cur[0]]];
        });
        var inputs = [];
        foreach(named of namedFields) {
          unpack [fieldId, name] = named;
          if(code.indexOf(name) > -1) {
            inputs.push([id, fieldId, name]);
          }
        }

        var filterIx = viewFields.length - (clearDiff.field ? clearDiff.field.removes.length : 0);
        diff.field = {adds: [[filterField, view, filterIx]], removes: []};
        diff.constantConstraint = {adds: [[query, filterField, true]], removes: []};
        diff.tag = {adds: [[id, "filter"],
                           [id, info.id],
                           [filterField, "filter"],
                           [filterField, "hidden"]
                          ], removes: []};
        diff.functionConstraint = {adds: [[id, query, filterField, code]], removes: []};
        diff.functionConstraintInput = {adds: inputs, removes: []};

      } else {
        // This is a constant filter.
        diff.constantConstraint = {adds: [[query, info.id, parseValue(info.text)]], removes: []};
      }

      helpers.merge(diff, clearDiff);
      indexer.handleDiffs(diff);
      break;

    case "updateCalculated":
      var table = info.table;
      var field = info.field;
      var value = info.value;
      var diff = {};

      //@TODO: we can't assume there's only ever one query...
      unpack [queryId] = indexer.index("query", "collector", [1])[table][0];

      //it is either an aggregateConstraint, a functionConstraint, or a constantConstraint
      //@TODO: this is super frail. Filters are function + constant and you can filter a
      //the result of a function. How would we know what to edit?

      var functions = indexer.index("functionConstraint", "collector", [1])[queryId] || [];
      var foundFunc = functions.filter(function(cur) {
        unpack [id, queryId, constraintField] = cur;
        return constraintField === field;
      });

      var aggs = indexer.index("aggregateConstraint", "collector", [1])[queryId] || [];
      var foundAgg = functions.filter(function(cur) {
        unpack [id, queryId, constraintField] = cur;
        return constraintField === field;
      });

      var constants = indexer.index("constantConstraint", "collector", [0])[queryId] || [];
      var foundConstant = constants.filter(function(cur) {
        unpack [id, constraintField] = cur;
        return constraintField === field;
      });

      if(foundFunc.length) {
        unpack [constraintId] = foundFunc[0]
        diff.functionConstraint = {adds: [], removes: [foundFunc[0]]};
        diff.functionConstraintInput = {adds: [],
                                        removes: indexer.index("functionConstraintInput", "collector", [0])[constraintId] || []};
      } else if(foundAgg.length) {
        unpack [constraintId] = foundAgg[0]
        diff.aggregateConstraint = {adds: [], removes: [foundAgg[0]]};
        diff.aggregateConstraintAggregateInput = {adds: [],
                                                  removes: indexer.index("aggregateConstraintInput", "collector", [0])[constraintId] || []};
      } else if(foundConstant.length) {
        unpack [constraintId] = foundConstant[0]
        diff.constantConstraint = {adds: [], removes: [foundConstant[0]]};
      }


      // add a new thing.
      if(value[0] === "=") {
        //it's a function
        var id = global.uuid();
        var viewFields = indexer.index("field", "collector", [1])[table];
        var displayNames = indexer.index("displayName", "lookup", [0, 1]);
        var namedFields = viewFields.map(function(cur) {
          return [cur[0], displayNames[cur[0]]];
        });
        var inputs = [];
        foreach(named of namedFields) {
          unpack [fieldId, name] = named;
          if(value.indexOf(name) > -1) {
            inputs.push([id, fieldId, name]);
          }
        }

        var isAggregate = false;
        foreach(agg of aggregateFuncs) {
          if(value.indexOf(agg + "(") > -1) {
            isAggregate = true;
            break;
          }
        }

        if(isAggregate) {
          if(!diff.aggregateConstraint) {
            diff.aggregateConstraint = {adds: [], removes: []};
            diff.aggregateConstraintBinding = {adds: [], removes: []};
            diff.aggregateConstraintSolverInput = {adds: [], removes: []};
            diff.aggregateConstraintAggregateInput = {adds: [], removes: []};
          }
          var groups = viewFields.filter(function(cur) {
            return indexer.hasTag(cur[0], "grouped");
          }).map(function(cur) {
            return [id, cur[0], cur[0]];
          });
          diff.aggregateConstraint.adds.push([id, queryId, field, table, value.substring(1)]);
          //add groups
          diff.aggregateConstraintBinding.adds = groups;
          //add non-aggregate inputs
          diff.aggregateConstraintAggregateInput.adds = inputs;
        } else {
          if(!diff.functionConstraint) {
            diff.functionConstraint = {adds: [], removes: []};
            diff.functionConstraintInput = {adds: [], removes: []};
          }
          diff.functionConstraint.adds.push([id, queryId, field, value.substring(1)]);
          diff.functionConstraintInput.adds = inputs;
        }

      } else {
        //it's a constant
        if(!diff.constantConstraint) {
          diff.constantConstraint = {adds: [], removes: []};
        }
        diff.constantConstraint.adds.push([queryId, field, value]);
      }

      indexer.handleDiffs(diff);
      break;

    //---------------------------------------------------------
    // UI Editor
    //---------------------------------------------------------

    case "addUIEditorElementFromMenu":
      var id = global.uuid();
      var diff = {
        uiEditorElement: {adds: [], removes: []},
        activeUIEditorElement: {adds: [[id]], removes: indexer.facts("activeUIEditorElement")}
      }
      unpack [menuX, menuY] = indexer.first("contextMenu");
      //@TODO: it seems sketchy to query the DOM here, but we have to get the relative
      //position of the click to the design surface.
      var surfaceDimensions = document.querySelector(".ui-tile").getBoundingClientRect();
      var x = menuX - surfaceDimensions.left;
      var y = menuY - surfaceDimensions.top;
      var elem = [id, info, x, y, 100, 20];
      diff.uiEditorElement.adds.push(elem);
      var views = elementToViews(elem);
      forattr(table, values of views) {
        diff[table] = {adds: values, removes: []};
      }
      indexer.handleDiffs(diff);
      break;

    case "uiEditorElementMove":
      var diff = {
        uiEditorElement: {adds: [info.neue], removes: [info.old]}
      }
      var neueViews = elementToViews(info.neue);
      var oldViews = elementToViews(info.old);
      forattr(table, values of neueViews) {
        diff[table] = {adds: values, removes: oldViews[table]};
      }
      indexer.handleDiffs(diff);
      break;

    case "setActiveUIEditorElement":
      var diff = {
        activeUIEditorElement: {adds: [[info]], removes: indexer.facts("activeUIEditorElement")}
      };
      indexer.handleDiffs(diff);
      break;

    case "bindUIElementName":
      var elementId = info.id;
      var name = info.text;
      var force = info.force;
      if(!name) return;
      var eventFact = [elementId, "name", name, false];
      var diff = {
        uiEditorElementAttr: {adds: [eventFact], removes: []}
      };
      var prevEvents = indexer.index("uiEditorElementEvent", "collector", [0, 1])[elementId];
      var oldViews;
      var neueViews;
      //@TODO for now this will only affect events, but once we allow repetition
      //changing the name will affect every view created for this element.
      if(prevEvents) {
        forattr(type, events of prevEvents) {
          if(events && events[0]) {
            diff.uiEditorElementAttr.removes.push(events[0]);
            oldViews = elementEventToViews(events[0], oldViews);
            var updated = events[0].slice();
            updated[3] = name;
            diff.uiEditorElementAttr.adds.push(updated);
            neueViews = elementEventToViews(updated, neueViews);
          }
        }
      } else {
        neueViews = {};
        oldViews = {};
      }

      //remove the old name
      var prevName = indexer.index("uiEditorElementAttr", "collector", [0, 1])[elementId];
      if(prevName && prevName["name"] && prevName["name"][0]) {
        diff.uiEditorElementAttr.removes.push(prevName["name"][0]);
      }
      forattr(table, values of neueViews) {
        diff[table] = {adds: values, removes: oldViews[table] || []};
      }
      indexer.handleDiffs(diff);
      if(force) {
        dispatch(["clearContextMenu"]);
      }
      break;

    case "setUIElementEvent":
      var type = info;
      if(!type) return;
      var elementId = indexer.first("activeUIEditorElement")[0];
      var name = elementId;
      var attrs = indexer.index("uiEditorElementAttr", "collector", [0, 1])[elementId];
      if(attrs && attrs["name"] && attrs["name"][0]) {
        name = attrs["name"][0][2];
      }
      console.log("Have name: ", name);
      var eventFact = [elementId, type, type, name];
      var diff = {
        uiEditorElementEvent: {adds: [eventFact], removes: []}
      };
      var prevEvents = indexer.index("uiEditorElementEvent", "collector", [0, 1])[elementId];
      var oldViews = {};
      var prev;
      if(prevEvents) {
        prev = prevEvents[type];
        if(prev && prev[0]) {
          diff.uiEditorElementEvent.removes.push(prev[0]);
          oldViews = elementEventToViews(prev[0]);
        }
      }
      var neueViews = elementEventToViews(eventFact);
      forattr(table, values of neueViews) {
        diff[table] = {adds: values, removes: oldViews[table] || []};
      }
      indexer.handleDiffs(diff);
      var eventViewId = elementId + "|uiEvent|" + type;
      if(!indexer.index("tableTile", "lookup", [1, 0])[eventViewId]) {
        dispatch(["openView", {selected: [eventViewId]}]);
      } else {
        dispatch(["clearContextMenu"]);
      }
      break;

    case "bindUIElementStyle":
      var attr = info;
      var elementId = indexer.first("activeUIEditorElement")[0];
      var dropField = indexer.first("dropField");
      if(!dropField) return;
      unpack [table, field] = dropField;
      var eventFact = [elementId, attr, field, true];
      var diff = {
        uiEditorElementAttr: {adds: [eventFact], removes: []}
      };
      var prevEvents = indexer.index("uiEditorElementAttr", "collector", [0, 1])[elementId];
      var oldViews = {};
      var prev;
      if(prevEvents) {
        prev = prevEvents[attr];
        if(prev && prev[0]) {
          diff.uiEditorElementAttr.removes.push(prev[0]);
          oldViews = elementStyleToViews(prev[0]);
        }
      }
      var neueViews = elementStyleToViews(eventFact);
      forattr(table, values of neueViews) {
        diff[table] = {adds: values, removes: oldViews[table] || []};
      }
      indexer.handleDiffs(diff);
      break;

    case "bindUIElementText":
      var attr = info;
      var elementId = indexer.first("activeUIEditorElement")[0];
      var dropField = indexer.first("dropField");
      if(!dropField) return;
      unpack [table, field] = dropField;
      var eventFact = [elementId, "text", field, true];
      var diff = {
        uiEditorElementAttr: {adds: [eventFact], removes: []}
      };
      var prevEvents = indexer.index("uiEditorElementAttr", "collector", [0, 1])[elementId];
      var oldViews = {};
      var prev;
      if(prevEvents) {
        prev = prevEvents[attr];
        if(prev && prev[0]) {
          diff.uiEditorElementAttr.removes.push(prev[0]);
          oldViews = elementTextToViews(prev[0]);
        }
      }
      var neueViews = elementTextToViews(eventFact);
      forattr(table, values of neueViews) {
        diff[table] = {adds: values, removes: oldViews[table] || []};
      }
      indexer.handleDiffs(diff);
      break;

    case "setUIElementText":
      var text = info.text;
      var elementId = indexer.first("activeUIEditorElement")[0];
      var eventFact = [elementId, "text", text, false];
      var diff = {
        uiEditorElementAttr: {adds: [eventFact], removes: []}
      };
      var prevEvents = indexer.index("uiEditorElementAttr", "collector", [0, 1])[elementId];
      var oldViews = {};
      var prev;
      if(prevEvents) {
        prev = prevEvents[attr];
        if(prev && prev[0]) {
          diff.uiEditorElementAttr.removes.push(prev[0]);
          oldViews = elementTextToViews(prev[0]);
        }
      }
      var neueViews = elementTextToViews(eventFact);
      forattr(table, values of neueViews) {
        diff[table] = {adds: values, removes: oldViews[table] || []};
      }
      indexer.handleDiffs(diff);
      break;

    case "liveUIMode":
    case "designerUIMode":
      var tile = info;
      var mode = "live";
      if(event === "designerUIMode") {
        mode = "designer";
      }
      var removes = [];
      var prev = indexer.index("uiEditorMode", "lookup", [0, 1])[tile];
      if(prev) {
        removes = [[tile, prev]];
      }
      var diff = {
        uiEditorMode: {adds: [[tile, mode]], removes: removes}
      }
      indexer.handleDiffs(diff);
      break;

    //---------------------------------------------------------
    // Misc.
    //---------------------------------------------------------
    case "rename":
      var oldFact = indexer.index("displayName", "lookup", [0, 1])[info.id];
      var diff = {
        displayName: {adds: [[info.id, info.name]], removes: [oldFact]}
      };
      indexer.handleDiffs(diff);
      break;

    case "contextMenu":
      var diff = {
        contextMenu: {adds: [[info.e.clientX, info.e.clientY]], removes: indexer.facts("contextMenu") || []},
        contextMenuItem: {adds: info.items, removes: indexer.facts("contextMenuItem") || []},
      }
      indexer.handleDiffs(diff);
      break;

    case "clearContextMenu":
      var diff = {
        contextMenu: {adds: [], removes: indexer.facts("contextMenu") || []},
        contextMenuItem: {adds: [], removes: indexer.facts("contextMenuItem") || []},
      }
      indexer.handleDiffs(diff);
      break;


    default:
      console.warn("[dispatch] Unhandled event:", event, info);
  }
}
module.exports.dispatch = dispatch;

//---------------------------------------------------------
// UI Helpers
//---------------------------------------------------------

function elementEventToViews(event, results) {
  var results = results || {view: [], field: [], query: [], viewConstraint: [], viewConstraintBinding: [], constantConstraint: [], displayName: []};
  unpack [id, type, label, key] = event;
  //uiEvent view
  var uiEventFeederId = id + "|uiEventFeeder";
  results.view.push([uiEventFeederId]);
  results.field.push([uiEventFeederId + "|id", uiEventFeederId, 0],
                     [uiEventFeederId + "|event", uiEventFeederId, 1],
                     [uiEventFeederId + "|label", uiEventFeederId, 2],
                     [uiEventFeederId + "|key", uiEventFeederId, 3]);
  var uiEventFeederQueryId = uiEventFeederId + "|query";
  results.query.push([uiEventFeederQueryId, uiEventFeederId, 0]);
  results.constantConstraint.push([uiEventFeederQueryId, uiEventFeederId + "|id", id]);
  results.constantConstraint.push([uiEventFeederQueryId, uiEventFeederId + "|label", label]);
  results.constantConstraint.push([uiEventFeederQueryId, uiEventFeederId + "|event", type]);
  results.constantConstraint.push([uiEventFeederQueryId, uiEventFeederId + "|key", key]);

  var uiEventQueryId = id + "|uiEvent|Query";
  results.query.push([uiEventQueryId, "uiEvent", 0]);
  var uiEventViewConstraintId = uiEventQueryId + "|viewConstraint";
  results.viewConstraint.push([uiEventViewConstraintId, uiEventQueryId, uiEventFeederId, false]);
  results.viewConstraintBinding.push([uiEventViewConstraintId, "uiEvent|field=id", uiEventFeederId + "|id"]);
  results.viewConstraintBinding.push([uiEventViewConstraintId, "uiEvent|field=label", uiEventFeederId + "|label"]);
  results.viewConstraintBinding.push([uiEventViewConstraintId, "uiEvent|field=event", uiEventFeederId + "|event"]);
  results.viewConstraintBinding.push([uiEventViewConstraintId, "uiEvent|field=key", uiEventFeederId + "|key"]);

  //filtered view of Events for this event
  var filterViewId = id + "|uiEvent|" + type;
  results.view.push([filterViewId]);
  //if we haven't given this element a name, don't make a crazy view name
  if(id === key) {
    results.displayName.push([filterViewId, label + "events"]);
  } else {
    results.displayName.push([filterViewId, key + " " + label + "s"]);
  }
  results.field.push([filterViewId + "|id", filterViewId, 0],
                     [filterViewId + "|label", filterViewId, 2],
                     [filterViewId + "|key", filterViewId, 1]);
  results.displayName.push([filterViewId + "|id", "eventNumber"]);
  results.displayName.push([filterViewId + "|label", "event"]);
  results.displayName.push([filterViewId + "|key", "element"]);
  var filterViewQueryId = filterViewId + "|query";
  results.query.push([filterViewQueryId, filterViewId, 0]);
  var eventsViewConstraintId = filterViewQueryId + "|viewConstraint";
  results.viewConstraint.push([eventsViewConstraintId, filterViewQueryId, "event", false]);
  results.viewConstraintBinding.push([eventsViewConstraintId, filterViewId + "|id", "event|field=eid"]);
  results.viewConstraintBinding.push([eventsViewConstraintId, filterViewId + "|label", "event|field=label"]);
  results.viewConstraintBinding.push([eventsViewConstraintId, filterViewId + "|key", "event|field=key"]);
  results.constantConstraint.push([filterViewQueryId, filterViewId + "|label", label]);
  results.constantConstraint.push([filterViewQueryId, filterViewId + "|key", key]);

  if(type === "input") {
    results.field.push([filterViewId + "|value", filterViewId, 3]);
    results.displayName.push([filterViewId + "|value", "value"]);
    results.viewConstraintBinding.push([eventsViewConstraintId, "event|field=value", filterViewId + "|value"]);
  }

  return results;
}

function elementAttrToViews(attr) {
  unpack [elementId, attrType, value, isBinding] = attr;
  if(attrType === "text") {
    elementTextToViews(results, attr);
  }
  return results;
}

function elementTextToViews(text) {
  var results = {view: [], field: [], query: [], viewConstraint: [], viewConstraintBinding: [], constantConstraint: [], displayName: []};
  unpack [id, __, field, isBinding] = text;
  var view = indexer.index("field", "lookup", [0, 1])[field];
  //uiText view
  var uiTextFeederId = id + "|uiTextFeeder";
  var uiTextId = id + "|uiText";
  results.view.push([uiTextFeederId]);
  results.field.push([uiTextFeederId + "|id", uiTextFeederId, 0],
                     [uiTextFeederId + "|text", uiTextFeederId, 1]);
  var uiTextFeederQueryId = uiTextFeederId + "|query";
  results.query.push([uiTextFeederQueryId, uiTextFeederId, 0]);
  results.constantConstraint.push([uiTextFeederQueryId, uiTextFeederId + "|id", uiTextId]);
  //create a viewConstraint and bind it
  if(isBinding) {
    var bindingVCId = uiTextFeederQueryId + "|" + view + "|viewConstraint";
    results.viewConstraint.push([bindingVCId, uiTextFeederQueryId, view, false]);
    results.viewConstraintBinding.push([bindingVCId, uiTextFeederId + "|text", field]);
  } else {
    //otherwise it's just a constant
    results.constantConstraint.push([uiTextFeederQueryId, uiTextFeederId + "|text", field]);
  }

  var uiTextQueryId = id + "|uiText|Query";
  results.query.push([uiTextQueryId, "uiText", 0]);
  var uiTextViewConstraintId = uiTextQueryId + "|viewConstraint";
  results.viewConstraint.push([uiTextViewConstraintId, uiTextQueryId, uiTextFeederId, false]);
  results.viewConstraintBinding.push([uiTextViewConstraintId, "uiText|field=id", uiTextFeederId + "|id"]);
  results.viewConstraintBinding.push([uiTextViewConstraintId, "uiText|field=text", uiTextFeederId + "|text"]);

  //uiChild view for uiText
  var uiChildTextFeederId = id + "|uiChildTextFeeder";
  results.view.push([uiChildTextFeederId]);
  results.field.push([uiChildTextFeederId + "|parent", uiChildTextFeederId, 0],
                     [uiChildTextFeederId + "|pos", uiChildTextFeederId, 1],
                     [uiChildTextFeederId + "|child", uiChildTextFeederId, 2]);
  var uiChildTextFeederQueryId = uiChildTextFeederId + "|query";
  results.query.push([uiChildTextFeederQueryId, uiChildTextFeederId, 0]);
  results.constantConstraint.push([uiChildTextFeederQueryId, uiChildTextFeederId + "|parent", id]);
  results.constantConstraint.push([uiChildTextFeederQueryId, uiChildTextFeederId + "|pos", 0]);
  results.constantConstraint.push([uiChildTextFeederQueryId, uiChildTextFeederId + "|child", uiTextId]);

  var uiChildTextQueryId = id + "|uiChildText|Query";
  results.query.push([uiChildTextQueryId, "uiChild", 0]);
  var uiChildTextViewConstraintId = uiChildTextQueryId + "|viewConstraint";
  results.viewConstraint.push([uiChildTextViewConstraintId, uiChildTextQueryId, uiChildTextFeederId, false]);
  results.viewConstraintBinding.push([uiChildTextViewConstraintId, "uiChild|field=parent", uiChildTextFeederId + "|parent"]);
  results.viewConstraintBinding.push([uiChildTextViewConstraintId, "uiChild|field=pos", uiChildTextFeederId + "|pos"]);
  results.viewConstraintBinding.push([uiChildTextViewConstraintId, "uiChild|field=child", uiChildTextFeederId + "|child"]);
  return results;
}

function elementToViews(element) {
  var typeToDOM = {"box": "div", "button": "button", "text": "span", "input": "input"};
  var results = {view: [], field: [], query: [], viewConstraint: [], viewConstraintBinding: [], constantConstraint: [], displayName: []};
  unpack [id, type, x, y, width, height] = element;
  //uiElem view
  var uiElemFeederId = id + "|uiElemFeeder";
  results.view.push([uiElemFeederId]);
  results.field.push([uiElemFeederId + "|id", uiElemFeederId, 0],
                     [uiElemFeederId + "|type", uiElemFeederId, 1]);
  var uiElemFeederQueryId = uiElemFeederId + "|query";
  results.query.push([uiElemFeederQueryId, uiElemFeederId, 0]);
  results.constantConstraint.push([uiElemFeederQueryId, uiElemFeederId + "|id", id]);
  results.constantConstraint.push([uiElemFeederQueryId, uiElemFeederId + "|type", typeToDOM[type]]);

  var uiElemQueryId = id + "|uiElem|Query";
  results.query.push([uiElemQueryId, "uiElem", 0]);
  var uiElemViewConstraintId = uiElemQueryId + "|viewConstraint";
  results.viewConstraint.push([uiElemViewConstraintId, uiElemQueryId, uiElemFeederId, false]);
  results.viewConstraintBinding.push([uiElemViewConstraintId, "uiElem|field=id", uiElemFeederId + "|id"]);
  results.viewConstraintBinding.push([uiElemViewConstraintId, "uiElem|field=type", uiElemFeederId + "|type"]);

  //uiAttr view - pack all the styles into style
  var styleStr = "top: " + y + "px; left: " + x + "px; width:" + width + "px; height:" + height + "px; position:absolute;";
  var uiAttrFeederId = id + "|uiAttrFeeder";
  results.view.push([uiAttrFeederId]);
  results.field.push([uiAttrFeederId + "|id", uiAttrFeederId, 0],
                     [uiAttrFeederId + "|attr", uiAttrFeederId, 1],
                     [uiAttrFeederId + "|value", uiAttrFeederId, 2]);
  var uiAttrFeederQueryId = uiAttrFeederId + "|query";
  results.query.push([uiAttrFeederQueryId, uiAttrFeederId, 0]);
  results.constantConstraint.push([uiAttrFeederQueryId, uiAttrFeederId + "|id", id]);
  results.constantConstraint.push([uiAttrFeederQueryId, uiAttrFeederId + "|attr", "style"]);
  results.constantConstraint.push([uiAttrFeederQueryId, uiAttrFeederId + "|value", styleStr]);

  var uiAttrQueryId = id + "|uiAttr|Query";
  results.query.push([uiAttrQueryId, "uiAttr", 0]);
  var uiAttrViewConstraintId = uiAttrQueryId + "|viewConstraint";
  results.viewConstraint.push([uiAttrViewConstraintId, uiAttrQueryId, uiAttrFeederId, false]);
  results.viewConstraintBinding.push([uiAttrViewConstraintId, "uiAttr|field=id", uiAttrFeederId + "|id"]);
  results.viewConstraintBinding.push([uiAttrViewConstraintId, "uiAttr|field=attr", uiAttrFeederId + "|attr"]);
  results.viewConstraintBinding.push([uiAttrViewConstraintId, "uiAttr|field=value", uiAttrFeederId + "|value"]);

  //uiChild view
  var uiChildFeederId = id + "|uiChildFeeder";
  results.view.push([uiChildFeederId]);
  results.field.push([uiChildFeederId + "|parent", uiChildFeederId, 0],
                     [uiChildFeederId + "|pos", uiChildFeederId, 1],
                     [uiChildFeederId + "|child", uiChildFeederId, 2]);
  var uiChildFeederQueryId = uiChildFeederId + "|query";
  results.query.push([uiChildFeederQueryId, uiChildFeederId, 0]);
  results.constantConstraint.push([uiChildFeederQueryId, uiChildFeederId + "|parent", "eve-root"]);
  results.constantConstraint.push([uiChildFeederQueryId, uiChildFeederId + "|pos", 0]);
  results.constantConstraint.push([uiChildFeederQueryId, uiChildFeederId + "|child", id]);

  var uiChildQueryId = id + "|uiChild|Query";
  results.query.push([uiChildQueryId, "uiChild", 0]);
  var uiChildViewConstraintId = uiChildQueryId + "|viewConstraint";
  results.viewConstraint.push([uiChildViewConstraintId, uiChildQueryId, uiChildFeederId, false]);
  results.viewConstraintBinding.push([uiChildViewConstraintId, "uiChild|field=parent", uiChildFeederId + "|parent"]);
  results.viewConstraintBinding.push([uiChildViewConstraintId, "uiChild|field=pos", uiChildFeederId + "|pos"]);
  results.viewConstraintBinding.push([uiChildViewConstraintId, "uiChild|field=child", uiChildFeederId + "|child"]);
  return results;

}

//---------------------------------------------------------
// AST helpers
//---------------------------------------------------------

function namespacedField(displayNames, tableAndField) {
  unpack [table, field] = tableAndField;
  return displayNames[table] + "." + displayNames[field];
}

function viewToDSL(view) {
  var displayNames = indexer.index("displayName", "lookup", [0, 1]);
  var queries = indexer.index("query", "collector", [1])[view];
  if(!queries) return;
  var query = queries[0];
  var final = "";
  var queryId = query[0];

  var constants = indexer.index("constantConstraint", "collector", [0])[queryId];
  var viewConstraints = indexer.index("viewConstraint", "collector", [1])[queryId];
  var viewConstraintBindings = {};
  var VCBIndex = indexer.index("viewConstraintBinding", "collector", [0]);
  foreach(vc of viewConstraints) {
    unpack [id, __, sourceView] = vc;
    var bindings = VCBIndex[id];
    if(!bindings) continue;

    foreach(binding of bindings) {
      unpack [__, field, sourceField] = binding;
      if(!viewConstraintBindings[field]) {
        viewConstraintBindings[field] = [];
      }
      viewConstraintBindings[field].push([sourceView, sourceField]);
    }
  }

  var functionConstraints = indexer.index("functionConstraint", "collector", [1])[queryId];
  var aggregateConstraints = indexer.index("aggregateConstraint", "collector", [1])[queryId];
  var aggregateConstraintBindings = {};
  var ACBIndex = indexer.index("aggregateConstraintBinding", "lookup", [0, false]);
  foreach(agg of aggregateConstraints) {
    unpack [id, __, field, sourceView, code] = agg;
    var bindings = ACBIndex[id];
    if(!bindings) continue;

    foreach(binding of bindings) {
      unpack [__, field, sourceField] = binding;
      if(!aggregateConstraintBindings[field]) {
        aggregateConstraintBindings[field] = [];
      }
      aggregateConstraintBindings[field].push([sourceView, sourceField]);
    }
  }

  foreach(vc of viewConstraints) {
    unpack [id, __, sourceView] = vc;
    final += "with " + displayNames[sourceView] + "\n";
  }

  foreach(agg of aggregateConstraints) {
    unpack [id, query, field, sourceView, code] = agg;
    final += "with { " + displayNames[sourceView] + " }\n";
  }

  var constantFields = {};
  foreach(constant of constants) {
    unpack [queryId, field, value] = constant;
    constantFields[field] = value;
    if(viewConstraintBindings[field]) {
      final += namespacedField(displayNames, viewConstraintBindings[field][0]) + " = " + JSON.stringify(value) + "\n";
    }
  }

  forattr(field, bindings of viewConstraintBindings) {
    if(bindings.length > 1) {
      final += namespacedField(displayNames, bindings[0]);
      final += " = " + namespacedField(displayNames, bindings[1]);
      final += "\n";
    }
  }

  forattr(field, bindings of aggregateConstraintBindings) {
    var vcb = viewConstraintBindings[field];
    var constant = constantFields[field];
    if(bindings.length) {
      var cur = displayNames[field];
      if(vcb) {
        cur = namespacedField(displayNames, vcb[0]);
      } else if(constantFields[field]) {
        cur = JSON.stringify(constantFields[field]);
      }
      final += namespacedField(displayNames, bindings[0]);
      final += " = " + cur;
      final += "\n";
    }
  }

  var filters = [];
  foreach(func of functionConstraints) {
    unpack [id, query, field, code] = func;
    if(!indexer.hasTag(id, "filter")) {
      final += displayNames[field] + " = " + code.trim() + "\n";
    } else {
      filters.push(code.trim());
    }
  }

  foreach(agg of aggregateConstraints) {
    unpack [id, query, field, sourceView, code] = agg;
    final += displayNames[field] + " = " + code.trim() + "\n";
  }

  foreach(filter of filters) {
    final += filter + "\n";
  }

  return final;
}

global.viewToDSL = viewToDSL;

//---------------------------------------------------------
// IDE tables
//---------------------------------------------------------

function ideTables() {
  var facts = [];
  pushAll(facts, inputView("editId", ["view", "fact", "id"], ["system input"]));
  pushAll(facts, inputView("join", ["field", "sourceField"]));
  pushAll(facts, inputView("activePosition", ["w", "h", "x", "y"]));
  pushAll(facts, inputView("activeGrid", ["grid"]));
  pushAll(facts, inputView("activeTile", ["tile"]));
  pushAll(facts, inputView("gridTile", ["tile", "grid", "type", "w", "h", "x", "y"]));
  pushAll(facts, inputView("tableTile", ["tile", "table"]));
  pushAll(facts, inputView("tileTarget", ["tile", "target"]));
  pushAll(facts, inputView("contextMenu", ["x", "y"]));
  pushAll(facts, inputView("contextMenuItem", ["pos", "type", "text", "event", "id"]));
  pushAll(facts, inputView("uiEditorElement", ["id", "type", "x", "y", "w", "h"]));
  pushAll(facts, inputView("uiEditorMode", ["tile", "mode"]));
  pushAll(facts, inputView("uiEditorElementEvent", ["element", "event", "label", "key"]));
  pushAll(facts, inputView("uiEditorElementAttr", ["element", "attr", "value", "isBinding"]));
  pushAll(facts, inputView("activeUIEditorElement", ["element"]));
  pushAll(facts, inputView("dragField", ["table", "field"]));
  pushAll(facts, inputView("dropField", ["table", "field"]));
  return facts;
}

//---------------------------------------------------------
// Init
//---------------------------------------------------------

function startingDiffs() {
  return {
    activeGrid: {adds: [["default"]], removes: []},
    gridTile: {adds: [
      ["uiTile", "default", "ui", ui.defaultSize[0], ui.defaultSize[1], 0, 0],
      ["uiTileFull", "grid://ui", "ui", 12, 12, 0, 0]
    ], removes: []},
    tileTarget: {adds: [["uiTile", "grid://uiTile"]], removes: []}
  };
}

function init(program) {
  program.system.update(ideTables(), []);
  program.system.recompile();
  window._indexer = indexer = program.indexer;
  ui.init(indexer, dispatch);
  window.addEventListener("popstate", function(e) {
    dispatch(["locationChange", event]);
  });
  indexer.handleDiffs(startingDiffs());
}

module.exports.init = init;

function handleProgramDiffs(diffs) {
  indexer.handleDiffs(diffs, true);
}
module.exports.handleProgramDiffs = handleProgramDiffs;

function diffsHandled(diffs) {
  dispatch(["diffsHandled", diffs]);
}
module.exports.diffsHandled = diffsHandled;
