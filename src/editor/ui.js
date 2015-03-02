import macros from "../macros.sjs";

var document = global.document;
var _ = require("lodash");
var React = require("react/addons");
var bootstrap = require("./bootstrap");
var grid = require("./grid");
var helpers = require("./helpers");
var JSML = require("./jsml");
var incrementalUI = require("./incrementalUI");

//---------------------------------------------------------
// Globals
//---------------------------------------------------------

var indexer;
var dispatch;
var defaultSize = [12,3]; //@FIXME: duplicated in ide.js
var aggregateFuncs = ["sum", "count", "avg", "maxBy"];
var KEYCODES = {
  UP: 38,
  DOWN: 40,
  LEFT: 37,
  RIGHT: 39,
  ENTER: 13,
  ESCAPE: 27
};

//---------------------------------------------------------
// React helpers
//---------------------------------------------------------

function init(_indexer, dispatcher) {
  dispatch = dispatcher;
  indexer = _indexer;
  React.unmountComponentAtNode(document.body);
  var dims = document.body.getBoundingClientRect();
  tileGrid = grid.makeGrid(document.body, {
    dimensions: [dims.width - 100, dims.height - 110],
    gridSize: [12, 12],
    marginSize: [10,10]
  });
};
module.exports.init = init;

function render() {
  React.render(Root(), document.body);
}
module.exports.render = render;

function reactFactory(obj) {
  return React.createFactory(React.createClass(obj));
}

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
// Mixins
//---------------------------------------------------------

var editableRowMixin = {
  getInitialState: function() {
    return {edits: [], activeField: -1};
  },
  click: function(e) {
    var ix = parseInt(e.currentTarget.getAttribute("data-ix"), 10);
    this.setState({activeField: ix});
    e.currentTarget.focus();
    e.stopPropagation();
  },
  keyDown: function(e) {
    //handle pressing enter
    if(e.keyCode === KEYCODES.ENTER) {
      this.blur();
      e.preventDefault();
    }
  },
  input: function(e) {
    var edits = this.state.edits;
    edits[this.state.activeField] = parseValue(e.target.textContent);
  },
  blur: function(e) {
    var commitSuccessful = this.commit(this.state.activeField);
    this.setState({activeField: -1});
    if(commitSuccessful) {
      this.setState({edits: []});
    }
  },
  wrapEditable: function(attrs, content) {
    var ix = attrs["data-ix"];
    var editing = this.state.activeField === ix;
    attrs.contentEditable = editing;
    attrs.className += (editing) ? " selected" : "";
    attrs.onClick = this.click;
    attrs.onKeyDown = this.keyDown;
    attrs.onInput = this.input;
    attrs.onBlur = this.blur;
    attrs.dangerouslySetInnerHTML = {__html: this.state.edits[ix] || content};
    return attrs;
  }
};

var headerMixin = {
  dragStart: function(e) {
    e.currentTarget.classList.add("dragging");
    dispatch(["dragField", {table: this.props.table, field: this.props.field[0]}]);
  },
  dragEnd: function(e) {
    e.currentTarget.classList.remove("dragging");
    dispatch(["clearDragField", {table: this.props.table, field: this.props.field[0]}]);
  },
  doubleClick: function(e) {
    e.stopPropagation();
    this.click(e);
  },
  wrapHeader: function(attrs, content) {
    attrs.draggable = true;
    attrs.onDoubleClick = this.doubleClick;
    attrs.onClick = null;
    attrs.onDragStart = this.dragStart;
    attrs.onDragEnd = this.dragEnd;
    return attrs;
  }
};

// @TODO: Consider rewriting row / adderRow to use this per field instead.
var editableFieldMixin = {
  getInitialState: function() {
    return {editing: false, edit: null};
  },
  click: function(e) {
    this.setState({editing: true});
    e.currentTarget.focus();
    e.stopPropagation();
  },
  stop: function(e) {
    e.stopPropagation();
  },
  keyDown: function(e) {
    //handle pressing enter
    if(e.keyCode === KEYCODES.ENTER) {
      this.state.force = true;
      e.currentTarget.blur();
      e.preventDefault();
    }
  },
  input: function(e) {
    this.state.edit = parseValue(e.target.textContent);
  },
  blur: function() {
    this.setState({editing: false});
    var commitSuccessful = this.commit(this.state.force);
    this.state.force = false;
    if(commitSuccessful) {
      this.setState({edit: ""});
    }
  },
  wrapEditable: function(attrs, content) {
    attrs.contentEditable = this.state.editing;
    attrs.className += (this.state.editing) ? " selected" : "";
    attrs.onClick = this.click;
    attrs.onDoubleClick = this.stop;
    attrs.onKeyDown = this.keyDown;
    attrs.onInput = this.input;
    attrs.onBlur = this.blur;
    attrs.dangerouslySetInnerHTML = {__html: this.state.edit || content};
    return attrs;
  }
};

var editableInputMixin = helpers.cloneShallow(editableFieldMixin);
editableInputMixin.input = function(e) {
  this.state.edit = e.target.value;
};
editableInputMixin.wrapEditable = function(attrs, content) {
    attrs.className += (this.state.editing) ? " selected" : "";
    attrs.onClick = this.click;
    attrs.onKeyDown = this.keyDown;
    attrs.onInput = this.input;
    attrs.onBlur = this.blur;
    attrs.value = this.state.edit || content;
    return attrs;
};


var uiEditorElementMixin = {
  getInitialState: function() {
    unpack [id, type, x, y, width, height] = this.props.elem;
    return {x: x, y: y, width: width, height: height};
  },
  dragStart: function(e) {
    var myDims = e.currentTarget.getBoundingClientRect();
    this.state.offsetX = e.clientX - myDims.left;
    this.state.offsetY = e.clientY - myDims.top;
    e.dataTransfer.setData("id", this.props.elem[0]);
    e.dataTransfer.setDragImage(document.getElementById("clear-pixel"), 0,0);
  },
  drag: function(e) {
    if(e.clientX && e.clientY) {
      var parentDims = document.querySelector(".ui-tile").getBoundingClientRect();
      this.setState({x: e.clientX - parentDims.left - this.state.offsetX, y: e.clientY - parentDims.top - this.state.offsetY});
    }
  },
  dragEnd: function(e) {
    this.moved();
    dispatch(["setActiveUIEditorElement", this.props.elem[0]]);
  },
  dragOver: function(e) {
    if(indexer.first("dragField")) {
      //class?
      e.preventDefault();
    }
  },
  drop: function(e) {
    e.stopPropagation();
    var dragged = indexer.first("dragField");
    if(dragged) {
      unpack[table, field] = dragged;
      if(this.dropMenu) {
        dispatch(["dropField", {table: table, field: field}]);
        dispatch(["setActiveUIEditorElement", this.props.elem[0]]);
        dispatch(["contextMenu", {e: {clientX: e.clientX, clientY: e.clientY},
                                  items: this.dropMenu()}]);
      }
    }
  },
  wrapStyle: function(opts) {
    var state = this.state;
    opts.style = {width: state.width, height: state.height, top: state.y, left: state.x, position: "absolute"};
    return opts;
  },
  wrapDragEvents: function(opts) {
    opts.draggable = "true";
    opts.onDrag = this.drag;
    opts.onDragStart = this.dragStart;
    opts.onDragEnd = this.dragEnd;
    return opts;
  },
  resize: function(dims) {
    this.setState({x: dims.x, y: dims.y, width: dims.width, height: dims.height});
  },
  moved: function() {
    unpack [id, type, x, y, width, height] = this.props.elem;
    dispatch(["uiEditorElementMove", {neue: [id, type, this.state.x, this.state.y, this.state.width, this.state.height],
                                      old: this.props.elem}]);
  },
  setActive: function(e) {
    dispatch(["setActiveUIEditorElement", this.props.elem[0]]);
    e.stopPropagation();
  },
  stopPropagation: function(e) { e.stopPropagation(); },
  contextMenu: function(e) {
    e.preventDefault();
    e.stopPropagation();
    dispatch(["setActiveUIEditorElement", this.props.elem[0]]);
    dispatch(["contextMenu", {e: {clientX: e.clientX, clientY: e.clientY},
                              items: this.contextMenuItems()}]);
  },
  isActive: function() {
    var active = indexer.first("activeUIEditorElement");
    if(!active) return false;
    return active[0] === this.props.elem[0];
  },
  render: function() {
    var state = this.state;
    return JSML.react(["div", {key: this.props.elem[0], onContextMenu: this.contextMenu, onClick: this.setActive, onDoubleClick: this.stopPropagation, onDragOver: this.dragOver, onDrop: this.drop},
                       this.isActive() ? Resizer({x: state.x, y: state.y, width: state.width, height: state.height, resize: this.resize, resizeEnd: this.moved}) : null,
                       this.element()
                      ]);
  }
};

//---------------------------------------------------------
// Stand alone components
//---------------------------------------------------------

var Resizer = reactFactory({
  handleSize: [8,8],
  minSize: [10,10],
  componentWillReceiveProps: function(neue) {
    if(this.state.x !== neue.x || this.state.y !== neue.y) {
      this.setState({x: neue.x, y: neue.y, width: neue.width, height: neue.height});
    }
  },
  wrapStyle: function(opts) {
    var state = this.state;
    opts.style = {width: state.width, height: state.height, top: state.y, left: state.x, position: "absolute"};
    return opts;
  },
  wrapHandleStyle: function(opts) {
    var dx = opts["data-x"];
    var dy = opts["data-y"];
    unpack [handleWidth, handleHeight] = this.handleSize;

    //init to left
    var x = handleWidth / -2;
    if(dx === "right") {
      x = (handleWidth / -2) + this.state.width;
    } else if(dx === "center") {
      x = (handleWidth / -2) + (this.state.width / 2);
    }

    //init to top
    var y = handleHeight / -2;
    if(dy === "bottom") {
      y = (handleHeight / -2) + this.state.height;
    } else if(dy === "middle") {
      y = (handleHeight / -2) + (this.state.height / 2);
    }

    opts.className += " resize-handle";
    opts.style = {width: handleWidth, height: handleHeight, top: y - 1, left: x - 1};
    return opts;
  },
  dragStart: function(e) {
    this.state.dx = e.currentTarget.getAttribute("data-x");
    this.state.dy = e.currentTarget.getAttribute("data-y");
    e.dataTransfer.setDragImage(document.getElementById("clear-pixel"), 0,0);
  },
  drag: function(e) {
    if(e.clientX && e.clientY) {
      var grandParentDims = document.querySelector(".ui-tile").getBoundingClientRect();
      var relX = e.clientX - grandParentDims.left;
      var relY = e.clientY - grandParentDims.top;

      var minSize = this.props.minSize || this.minSize;

      //init to doing nothing
      var x = this.state.x;
      var width = this.state.width;
      var xdiff = relX - x;
      if(this.state.dx === "left") {
        x = relX;
        width = this.state.width - xdiff;
        if(width < minSize[0]) {
          width = minSize[0];
          x = (this.state.x + this.state.width) - minSize[0];
        }
      } else if(this.state.dx === "right") {
        width = width + (xdiff - width);
        if(width < minSize[0]) {
          width = minSize[0];
        }
      }

      //init to doing nothing
      var y = this.state.y;
      var height = this.state.height;
      var ydiff = relY - y;
      if(this.state.dy === "top") {
        y = relY;
        height = height - ydiff;
        if(height < minSize[1]) {
          height = minSize[1];
          y = (this.state.y + this.state.height) - minSize[1];
        }
      } else if(this.state.dy === "bottom") {
        height = height + (ydiff - height);
        if(height < minSize[1]) {
          height = minSize[1];
        }
      }
      this.setState({x: x, y: y, width: width, height: height});
      if(this.props.resize) {
        this.props.resize(this.state);
      }
    }
  },
  dragEnd: function(e) {
    if(this.props.resizeEnd) {
      this.props.resizeEnd(this.state);
    }
  },
  wrapDragEvents: function(opts) {
    opts.draggable = "true";
    opts.onDrag = this.drag;
    opts.onDragStart = this.dragStart;
    opts.onDragEnd = this.dragEnd;
    return opts;
  },
  wrapHandle: function(opts) {
    return this.wrapDragEvents(this.wrapHandleStyle(opts));
  },
  getInitialState: function() {
    return {x: this.props.x, y: this.props.y, width: this.props.width, height: this.props.height};
  },
  render: function() {
    return JSML.react(["div", this.wrapStyle({className: "resizer"}),
                       ["div", this.wrapHandle({"data-x": "left", "data-y": "top", className: "nwse-handle"})],
                       ["div", this.wrapHandle({"data-x": "center", "data-y": "top", className: "ns-handle"})],
                       ["div", this.wrapHandle({"data-x": "right", "data-y": "top", className: "nesw-handle"})],
                       ["div", this.wrapHandle({"data-x": "right", "data-y": "middle", className: "ew-handle"})],
                       ["div", this.wrapHandle({"data-x": "right", "data-y": "bottom", className: "nwse-handle"})],
                       ["div", this.wrapHandle({"data-x": "center", "data-y": "bottom", className: "ns-handle"})],
                       ["div", this.wrapHandle({"data-x": "left", "data-y": "bottom", className: "nesw-handle"})],
                       ["div", this.wrapHandle({"data-x": "left", "data-y": "middle", className: "ew-handle"})]
                      ])
  }
});

var ProgramLoader = reactFactory({
  getInitialState: function() {
    var programs = Object.keys(bootstrap.taskManager.list());
    var current = bootstrap.taskManager.current().name;
    return {programs: programs, current: current};
  },
  change: function(e) {
    bootstrap.taskManager.run(e.target.value);
  },
  render: function() {
    var current = this.state.current;
    var options = [];
    foreach(ix, name of this.state.programs) {
      options.push(["option", {value: name}, name]);
    }
    return JSML.react(["select", {className: "program-loader", onChange: this.change, value: current}, options]);
  }
});

var searchMethod = {
  view: function searchForView(needle) {
    var results = [];
    var names = indexer.index("displayName", "lookup", [0, 1]);
    var name;
    foreach(view of indexer.facts("view")) {
      unpack [id] = view;
      name = names[id] ? names[id].toString() : false;
      if(name && name.toLowerCase().indexOf(needle.toLowerCase()) > -1) {
        results.push([id, name]);
      }
    }
    return results;
  },

  field: function searchForField(needle, searchOpts) {
    searchOpts = searchOpts || {};
    var results = [];
    var names = indexer.index("displayName", "lookup", [0, 1]);
    var name;
    var fields = indexer.index("field", "collector", [1])[searchOpts.view];
    if(!fields) {
      fields = indexer.facts("field");
    }
    foreach(field of fields) {
      unpack [id, view, ix] = field;
      name = names[id];
      if(name && name.toLowerCase().indexOf(needle.toLowerCase()) > -1) {
        results.push([id, name]);
      }
    }
    return results;
  }
};

var Searcher = reactFactory({
  getInitialState: function() {
    var search = searchMethod[this.props.type];
    if(!search) throw new Error("No search function defined for type: '" + this.props.type + "'.");
    return {active: false, index: undefined,
            current: "", value: "",
            max: this.props.max || 10,
            possible: search('', this.props.searchOpts),
            search: search};
  },

  input: function(e) {
    this.setState({
      active: true,
      index: undefined,
      value: e.target.value,
      current: e.target.value,
      possible: this.state.search(e.target.value, this.props.searchOpts)
    });
  },

  focus: function(e) { this.setState({active: true}); },
  blur: function(e) {},
  select: function(ix) {
    var cur = this.state.possible[ix];
    if(cur) {
      dispatch([this.props.event, {selected: cur, id: this.props.id}]);
    }
    var state = this.getInitialState();
    this.setState(state);
  },

  keydown: function(e) {
    var max = Math.min(this.state.possible.length, this.state.max);

    // FIXME: stupid 1 access to grab the name.
    switch (e.keyCode) {
      case KEYCODES.DOWN:
        e.preventDefault();
        if (this.state.index === undefined) {
          var newindex = 0;
          this.setState({index: newindex, value: this.state.possible[newindex][1]});
        } else if (this.state.index !== max) {
          var newindex = this.state.index + 1;
          this.setState({index: newindex, value: this.state.possible[newindex][1]});
        }
      break;
      case KEYCODES.UP:
        e.preventDefault();
        if (this.state.index === 0) {
          this.setState({index: undefined, value: this.state.current});
        } else if (this.state.index !== undefined) {
          var newindex = this.state.index - 1;
          this.setState({index: newindex, value: this.state.possible[newindex][1]});
        }
      break;
      case KEYCODES.ENTER:
        this.select(this.state.index || 0);
      break;
      case KEYCODES.ESCAPE:
        this.setState(this.getInitialState());
      break;
    }
  },

  render: function() {
    var cx = React.addons.classSet;
    var possible = this.state.possible;
    var possiblelength = possible.length;
    var results = [];
    for(var i = 0; i < this.state.max && i < possiblelength; i++) {
      results.push(SearcherItem({searcher: this, focus: this.state.index === i, ix: i, item: possible[i], select: this.select}));
    }
    return JSML.react(["div", {"className": cx({"searcher": true,
                                                "active": this.state.active})},
                       ["input", {"type": "text",
                                  className: "full-input",
                                  "placeholder": this.props.placeholder || "Search",
                                  "value": this.state.value,
                                  "onFocus": this.focus,
                                  "onBlur": this.blur,
                                  "onKeyDown": this.keydown,
                                  "onInput": this.input}],
                       ["ul", {},
                        results]]);
  }
});

var SearcherItem = reactFactory({
  click: function() {
    this.props.select(this.props.ix);
  },
  render: function() {
    var focus = this.props.focus ? "focused" : "";
    var name = this.props.item ? this.props.item[1] : "";
    return JSML.react(["li", {"onClick": this.click, className: "menu-item " + focus}, name]);
  }
});

var ContextMenuItems = {
  text: reactFactory({
    click: function() {
      dispatch([this.props.event, this.props.id]);
    },
    render: function() {
      return JSML.react(["div", {className: "menu-item", onClick: this.click}, this.props.text]);
    }
  }),
  input: reactFactory({
    mixins: [editableInputMixin],
    commit: function(force) {
      dispatch([this.props.event, {id: this.props.id, text: this.state.edit, force: force}]);
      return true;
    },
    render: function() {
      return JSML.react(["div", {className: "menu-item"},
                         ["input", this.wrapEditable({className: "full-input", type: "text", placeholder: this.props.text})]
                        ]);
    }
  }),
  viewSearcher: reactFactory({
    click: function(e) {
      e.stopPropagation();
    },
    render: function() {
      return JSML.react(["div", {className: "menu-item", onClick: this.click},
                         Searcher({event: this.props.event, placeholder: this.props.text, id: this.props.id, type: "view"})]);
    }
  }),
  fieldSearcher: reactFactory({
    click: function(e) {
      e.stopPropagation();
    },
    render: function() {
      return JSML.react(["div", {className: "menu-item", onClick: this.click},
                         Searcher({event: this.props.event, placeholder: this.props.text,
                                        id: this.props.id, type: "field",
                                        searchOpts: {view: indexer.index("field", "lookup", [0, 1])[this.props.id]}})]);
    }
  })
};

var ContextMenu = reactFactory({
  clear: function() {
    dispatch(["clearContextMenu"]);
  },
  render: function() {
    var items = indexer.facts("contextMenuItem").map(function(cur) {
      unpack [pos, type, text, event, id] = cur;
      return ContextMenuItems[type]({pos: pos, text: text, event: event, id: id});
    });
    return JSML.react(["div", {className: "menu-shade", onClick: this.clear},
                       ["div", {className: "menu", style: {top: this.props.y, left: this.props.x}},
                        items]]);
  }
});

//---------------------------------------------------------
// Root
//---------------------------------------------------------
var gridSize = [6, 2];

var Root = React.createFactory(React.createClass({
  adjustPosition: function(activeTile, cur) {
    unpack [tile, type, width, height, row, col] = cur;
    unpack [atile, atype, awidth, aheight, activeRow, activeCol] = activeTile;
    var rowOffset = row - activeRow;
    var colOffset = col - activeCol;
    var rowEdge = rowOffset > 0 ? tileGrid.rows + 1 : (rowOffset < 0 ? -2 * height : row);
    var colEdge = colOffset > 0 ? tileGrid.cols + 1 : (colOffset < 0 ? -2 * width : col);
    return [rowEdge, colEdge];
  },
  expand: function() {
    return {size: [tileGrid.cols - 0, tileGrid.rows],
            pos: [0, 0]};
  },
  render: function() {
    var activeTile;
    var activeTileTable;
    var activeTileEntry = indexer.first("activeTile");
    if(activeTileEntry) {
       activeTile = indexer.index("gridTile", "lookup", [0, false])[activeTileEntry[0]];
      if(activeTile[1] === "table") {
        activeTileTable = indexer.index("tableTile", "lookup", [0, 1])[activeTile[0]];
      }
    }
    var self = this;

    var tables = indexer.facts("gridTile").map(function(cur, ix) {
      unpack [tile, type, width, height, row, col] = cur;
      var gridItem = {};
      if(activeTile && tile !== activeTile[0]) {
        unpack [row, col] = self.adjustPosition(activeTile, cur);
      } else if(activeTile) {
        var expanded = self.expand();
        unpack [width, height] = expanded.size;
        unpack [row, col] = expanded.pos;
        gridItem.active = true;
      }

      gridItem.size = [width, height];
      gridItem.pos = [row, col];

      if(type === "table") {
        var table = indexer.index("tableTile", "lookup", [0, 1])[tile];
        gridItem.table = table;
        gridItem.tile = tile;
        return tiles.table(gridItem);
      } else if(type === "ui") {
        gridItem.tile = "uiTile";
        return tiles.ui(gridItem);
      }
    });

    var menu = indexer.first("contextMenu");
    var gridContainer = ["div", {"id": "cards", "onClick": this.click}, tables];

    // if there isn't an active tile, add placeholder tiles for areas that can hold them.
    if(!activeTile) {
      var gridItems = indexer.getTileFootprints();
      var activePosition = indexer.first("activePosition") || [];
      while(true) {
        var slot = grid.firstGap(tileGrid, gridItems, defaultSize);
        if(!slot) { break; }
        var gridItem = {size: defaultSize, pos: slot, active: (menu && activePosition[2] === slot[0] && activePosition[3] === slot[1])};
        gridItems.push(gridItem);
        gridContainer.push(tiles.addTile(gridItem));
      }
    }

    return JSML.react(["div",
                       ["canvas", {id: "clear-pixel", width: 1, height: 1}],
                       ProgramLoader(),
                       gridContainer,
                       menu ? ContextMenu({x: menu[0], y: menu[1]}) : null]);
  }
}));

//---------------------------------------------------------
// tiles
//---------------------------------------------------------

var tileGrid;

var tiles = {
  wrapper: reactFactory({
    doubleClick: function() {
      var active = indexer.first("activeTile");
      if(!active || active[0] !== this.props.tile) {
        dispatch(["selectTile", this.props.tile]);
      } else {
        dispatch(["deselectTile", this.props.tile]);
      }
    },
    close: function(e) {
      var active = indexer.first("activeTile");
      if(active && active[0] === this.props.tile) {
        dispatch(["deselectTile", this.props.tile]);
      }
      dispatch(["closeTile", this.props.tile]);
      e.stopPropagation();
    },
    contextMenu: function(e) {
    },
    render: function() {
      var selectable = (this.props.selectable !== undefined) ? this.props.selectable : true;
      var controls = "";
      if(this.props.controls !== false) {
        controls = ["div", {className: "tile-controls"},
                    ["button", {className: "tile-control close-btn",
                                onClick: this.close}, "X"]];
      }
      return JSML.react(["div", {"className": "card " + (this.props.class || ""),
                                 "key": this.props.tile,
                                 "onDrop": this.props.drop,
                                 "onDragOver": this.props.dragOver,
                                 "onContextMenu": this.props.contextMenu || this.contextMenu,
                                 "onDoubleClick": (selectable) ? this.doubleClick : undefined,
                                 "style": grid.getSizeAndPosition(tileGrid, this.props.size, this.props.pos)},
                         controls,
                         this.props.content]);
    }
  }),
  addTile: reactFactory({
    click: function(e) {
      e.preventDefault();
      e.stopPropagation();
      dispatch(["setActivePosition", [this.props.size[0], this.props.size[1], this.props.pos[0], this.props.pos[1]]]);
      dispatch(["contextMenu", {e: {clientX: e.clientX, clientY: e.clientY},
                                items: [
                                  [0, "text", "New Table", "addTableTile", ""],
                                  [1, "text", "New View", "addViewTile", ""],
                                  [2, "text", "New UI", "addUI", ""],
                                  [3, "viewSearcher", "Existing table or view", "openView", ""]
                                ]}]);
    },
    render: function() {
      var className = "add-tile" + (this.props.active ? " selected" : "");
      var content = JSML.react(["div", {onClick: this.click, onContextMenu: this.click}, "+"]);
      return tiles.wrapper({pos: this.props.pos, size: this.props.size, id: "addTile", class: className, content: content, controls: false, selectable: false});
    }
  }),
  table: reactFactory({
    title: reactFactory({
      mixins: [editableFieldMixin],
      commit: function() {
        if(!this.state.edit) { return; }
        dispatch(["rename", {id: this.props.id, name: this.state.edit}]);
        return true;
      },
      render: function() {
        var id = this.props.id;
        var name = this.state.edit || indexer.index("displayName", "lookup", [0, 1])[id];
        var label = "";
        if(indexer.hasTag(id, "constant")) { label = " - constant"; }
        else if(indexer.hasTag(id, "input")) { label = "- input"; }

        return JSML.react(
          ["h2",
           ["span", this.wrapEditable({key: id + "-title",}, name)],
           label]);
      }
    }),
    header: reactFactory({
      mixins: [editableFieldMixin, headerMixin],
      contextMenu: function(e) {
        e.preventDefault();
        e.stopPropagation();
        var id = this.props.field[0];
        var joins = indexer.index("join", "collector", [0])[id];
        var isJoined = joins && joins.length;

        var items = [
          [0, "input", "filter", "filterField", id],
          (indexer.hasTag(id, "grouped") ? [1, "text", "ungroup", "ungroupField", id] : [1, "text", "group", "groupField", id])
        ];
        if(isJoined) {
          items.push([items.length, "text", "unjoin", "unjoinField", id]);
        }
        items.push([items.length, "fieldSearcher", "join", "joinField", id])

        dispatch(["contextMenu", {e: {clientX: e.clientX, clientY: e.clientY},
                                  items: items}]);
      },
      commit: function() {
        unpack [id] = this.props.field;
        if(!this.state.edit) { return; }
        dispatch(["rename", {id: id, name: this.state.edit}]);
        return true;
      },
      render: function() {
        unpack [id] = this.props.field;
        var name = this.state.edit || indexer.index("displayName", "lookup", [0, 1])[id];
        var className = "header";
        if(indexer.hasTag(id, "grouped")) {
          className += " grouped";
        }
        var opts = this.wrapEditable({
          className: className,
          key: id,
          onContextMenu: this.contextMenu
        }, name);
        opts = this.wrapHeader(opts);
        return JSML.react(["div", opts]);
      }
    }),
    addHeader: reactFactory({
      mixins: [editableFieldMixin],
      commit: function() {
        if(!this.state.edit) { return; }
        dispatch(["addField", {view: this.props.view, name: this.state.edit}]);
        return true;
      },
      componentDidUpdate: function() {
        //@HACK: React doesn't correctly clear contentEditable fields
        this.getDOMNode().textContent = "";
      },
      render: function() {
        return JSML.react(["div", this.wrapEditable({
          className: "header add-header",
          key: this.props.view + "-add-header"}, "")]);
      }
    }),
    row: reactFactory({
      mixins: [editableRowMixin],
      commit: function(ix) {
        var table = this.props.table;

        //if this is a constant view, then we just modify the row
        if(indexer.hasTag(table, "constant")) {
          var oldRow = this.props.row;
          var newRow = oldRow.slice();
          var edits = this.state.edits;
          foreach(ix, field of newRow) {
            if(edits[ix] !== null && edits[ix] !== undefined) {
              newRow[ix] = edits[ix];
            }
          }
          dispatch(["updateRow", {table: table, oldRow: oldRow, newRow: newRow}]);
        } else if(ix > -1 && this.state.edits[ix] !== undefined) { //FIXME: how is blur getting called with an ix of -1?
          //if this isn't a constant view, then we have to modify
          dispatch(["updateCalculated", {table: table, field: this.props.fields[ix][0], value: this.state.edits[ix]}]);
        }
        return true;
      },
      render: function() {
        var fields = [];
        foreach(ix, field of this.props.row) {
          if(this.props.hidden[ix]) { continue; }
          fields.push(["div", this.wrapEditable({"data-ix": ix}, field)]);
        }
        return JSML.react(["div", {"className": "grid-row", "key": JSON.stringify(this.props.row)}, fields]);
      }
    }),
    adderRow: reactFactory({
      mixins: [editableRowMixin],
      checkComplete: function() {
        for(var i = 0, len = this.props.len; i < len; i++) {
          if(this.state.edits[i] === undefined || this.state.edits[i] === null) return false;
        }
        return true;
      },
      commit: function() {
        if(this.checkComplete()) {
          var row = this.state.edits.slice();
          dispatch(["addRow", {table: this.props.table, row: row}]);
          //@HACK: React doesn't correctly clear contentEditable fields
          foreach(ix, _ of row) {
            this.getDOMNode().children[ix].textContent = "";
          }
          return true;
        }
        return false;
      },
      render: function() {
        var fields = [];
        var className;
        var contentEditable;
        for(var i = 0, len = this.props.len; i < len; i++) {
          fields.push(["div", this.wrapEditable({"tabIndex": -1, "data-ix": i}, "")]);
        }
        return JSML.react(["div", {"className": "grid-row add-row", "key": "adderRow"}, fields]);
      }
    }),
    contextMenu: function(e) {
      var isInput = indexer.hasTag(this.props.table, "input");
      if(!isInput) {
        e.preventDefault();
        dispatch(["contextMenu", {e: {clientX: e.clientX, clientY: e.clientY},
                                  items: [
                                    [0, "viewSearcher", "Add table", "addTableToView", this.props.table]
                                  ]}]);
      }
    },
    dragOver: function(e) {
      if(indexer.first("dragField")) {
        //class?
        e.preventDefault();
      }
    },
    drop: function(e) {
      e.stopPropagation();
      var dragged = indexer.first("dragField");
      if(dragged) {
        unpack[table, field] = dragged;
        if(this.props.table !== table) {
          dispatch(["addFieldToView", {table: table, field: field, current: this.props.table}]);
        }
      }
    },
    render: function() {
      var self = this;
      var table = this.props.table;
      var viewFields = indexer.index("field", "collector", [1])[table] || [];
      viewFields = _.sortBy(viewFields, 2);
      var hidden = [];
      var grouped = [];
      var headers = viewFields.map(function(cur, ix) {
        hidden[ix] = indexer.hasTag(cur[0], "hidden");
        if(indexer.hasTag(cur[0], "grouped")) {
          grouped.push(ix);
        }
        if(!hidden[ix]) {
          return self.header({field: cur, table: table});
        }
      });


      function indexToRows(index, hidden, startIx) {
        startIx = startIx || 0;
        hidden = hidden || [];
        var rows = [];
        if(index instanceof Array) {
          rows = index.map(function factToRow(cur) {
            return self.row({row: cur, table: table, fields: viewFields, hidden: hidden});
          }).filter(Boolean);
        } else {
          var newHidden = hidden.slice();
          newHidden[startIx] = true;
          forattr(value, group of index) {
            var groupRow = ["div", {className: "grid-group"}];
            groupRow.push.apply(groupRow, indexToRows(group, newHidden, startIx + 1));
            rows.push(["div", {className: "grid-row grouped-row"},
                       ["div", {className: "grouped-field"}, value],
                       groupRow]);
          }
        }
        return rows;
      }

      var rowIndex;
      // @TODO: Reimplement grouping.
      if(grouped.length) {
        rowIndex = indexer.index(table, "collector", grouped);
      } else {
        rowIndex = indexer.facts(table) || [];
      }
      var rows = indexToRows(rowIndex, hidden);
      var isConstant = indexer.hasTag(table, "constant");
      var isInput = indexer.hasTag(table, "input");
      var className = (isConstant || isInput) ? "input-card" : "view-card";
      var content =  [self.title({id: table}),
                      (this.props.active ? ["pre", viewToDSL(table)] : null),
                      ["div", {className: "grid"},
                       ["div", {className: "grid-header"},
                        headers,
                        self.addHeader({view: table})],
                       ["div", {className: "grid-rows"},
                        rows,
                        isConstant ? this.adderRow({len: headers.length, table: table}) : null]]];
      return tiles.wrapper({pos: this.props.pos, size: this.props.size, tile: this.props.tile, class: className, content: content, contextMenu: this.contextMenu,
                           drop: this.drop, dragOver: this.dragOver});
    }
  }),
  ui: reactFactory({
    //we create this container element because we need something that will
    //never update, otherwise the content that gets injected by the program
    //will get removed.
    container: reactFactory({
      shouldComponentUpdate: function(props, state) {
        return false;
      },
      componentDidMount: function() {
        this.getDOMNode().appendChild(incrementalUI.storage["builtEls"]["eve-root"]);
      },
      click: function(e) {
        e.stopPropagation();
        e.preventDefault();
      },
      render: function() {
        return JSML.react(["div", {"className": "uiCard",
                                   "onDoubleClick": this.click}]);
      }
    }),
    box: reactFactory({
      mixins: [uiEditorElementMixin],
      element: function() {
        var opts = this.wrapStyle(this.wrapDragEvents({className: "uiElement box"}));
        return ["div", opts];
      }
    }),
    text: reactFactory({
      mixins: [uiEditorElementMixin],
      dropMenu: function(table, field) {
        return [
          [0, "text", "text", "bindUIElementText", "text"]
        ];
      },
      contextMenuItems: function(e) {
        return [
          [0, "text", "Live view", "liveUIMode", this.props.tile],
        ];
      },
      element: function() {
        var opts = this.wrapStyle(this.wrapDragEvents({className: "text uiElement"}));
        var attrs = indexer.index("uiEditorElementAttr", "collector", [0, 1])[this.props.elem[0]];
        var text = "";
        if(attrs && attrs["text"]) {
          unpack [_, attr, field, isBinding] = attrs["text"][0];
          if(isBinding) {
            text = "Bound to " + indexer.index("displayName", "lookup", [0, 1])[field];
          } else {
            text = field;
          }
        }
        return ["span", opts, text];
      }
    }),
    button: reactFactory({
      mixins: [uiEditorElementMixin, editableFieldMixin],
      dropMenu: function(table, field) {
        return [
          [0, "text", "text", "bindUIElementText", "text"]
        ];
      },
      contextMenuItems: function(e) {
        return [
          [0, "text", "Live view", "liveUIMode", this.props.tile],
          [1, "input", "Button name", "bindUIElementName", this.props.elem[0]],
          [2, "input", "Text", "setUIElementText", this.props.elem[0]],
          [3, "text", "Get clicks", "setUIElementEvent", "click"]
        ];
      },
      commit: function() {
        dispatch(["setUIElementText", this.state.edit]);
      },
      element: function() {
        var attrs = indexer.index("uiEditorElementAttr", "collector", [0, 1])[this.props.elem[0]];
        var text = "";
        if(attrs && attrs["text"]) {
          unpack [_, attr, field, isBinding] = attrs["text"][0];
          if(isBinding) {
            text = "Bound to " + indexer.index("displayName", "lookup", [0, 1])[field];
          } else {
            text = field;
          }
        }
        var opts = this.wrapStyle(this.wrapDragEvents({className: "uiElement button"}));
        return ["button", opts, text];
      }
    }),
    input: reactFactory({
      mixins: [uiEditorElementMixin],
      contextMenuItems: function(e) {
        return [
          [0, "text", "Live view", "liveUIMode", this.props.tile],
          [1, "input", "input", "setUIElementEvent", "input"]
        ];
      },
      element: function() {
        var opts = this.wrapStyle(this.wrapDragEvents({placeholder: "input", className: "uiElement input"}));
        return ["div", opts];
      }
    }),
    contextMenu: function(e) {
      e.preventDefault();
      var mode = indexer.index("uiEditorMode", "lookup", [0, 1])[this.props.tile] || "designer";
      if(mode === "designer") {
        dispatch(["contextMenu", {e: {clientX: e.clientX, clientY: e.clientY},
                                  items: [
                                    [0, "text", "Live view", "liveUIMode", this.props.tile],
                                    [1, "text", "box", "addUIEditorElementFromMenu", "box"],
                                    [2, "text", "text", "addUIEditorElementFromMenu", "text"],
                                    [3, "text", "button", "addUIEditorElementFromMenu", "button"],
                                    [4, "text", "input", "addUIEditorElementFromMenu", "input"]
                                  ]}]);
      } else {
        dispatch(["contextMenu", {e: {clientX: e.clientX, clientY: e.clientY},
                                  items: [
                                    [0, "text", "Designer", "designerUIMode", this.props.tile]
                                  ]}]);
      }
    },
    render: function() {
      var self = this;
      var mode = indexer.index("uiEditorMode", "lookup", [0, 1])[this.props.tile] || "designer";
      var switcherClick = function(mode) {
        return function(e) {
          dispatch([mode, self.props.tile]);
        }
      }
      var switcher = JSML.react(["div", {className: "switcher"},
                                 ["span", {className: mode === "designer" ? "active" : "", onClick: switcherClick("designerUIMode")}, "designer"],
                                 ["span", {className: mode === "live" ? "active" : "", onClick: switcherClick("liveUIMode")},"live"]])
      if(mode === "designer") {
        var self = this;
        var editorElems = indexer.facts("uiEditorElement").map(function(cur) {
          unpack [id, type] = cur;
          return self[type]({elem: cur, tile: self.props.tile, key: id});
        });
        var content = [switcher,
          JSML.react(["div", {className: "ui-design-surface"},
                                  editorElems])];
      } else {
        var content = [switcher, this.container({})];
      }

      return tiles.wrapper({class: "ui-tile", controls: false, content: content, contextMenu: this.contextMenu,
                            pos: this.props.pos, size: this.props.size, tile: this.props.tile});
    }
  })
};

