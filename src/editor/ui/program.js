import macros from "../../macros.sjs";

var incrementalUI = require("../incrementalUI");
var JSML = require("../jsml");
var ui = require("./");
var reactFactory = ui.reactFactory;

// Mixins

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
    ui.dispatch(["setActiveUIEditorElement", this.props.elem[0]]);
  },
  dragOver: function(e) {
    if(ui.indexer.first("dragField")) {
      //class?
      e.preventDefault();
    }
  },
  drop: function(e) {
    e.stopPropagation();
    var dragged = ui.indexer.first("dragField");
    if(dragged) {
      unpack[table, field] = dragged;
      if(this.dropMenu) {
        ui.dispatch(["dropField", {table: table, field: field}]);
        ui.dispatch(["setActiveUIEditorElement", this.props.elem[0]]);
        ui.dispatch(["contextMenu", {e: {clientX: e.clientX, clientY: e.clientY},
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
    ui.dispatch(["uiEditorElementMove", {neue: [id, type, this.state.x, this.state.y, this.state.width, this.state.height],
                                      old: this.props.elem}]);
  },
  setActive: function(e) {
    ui.dispatch(["setActiveUIEditorElement", this.props.elem[0]]);
    e.stopPropagation();
  },
  stopPropagation: function(e) { e.stopPropagation(); },
  contextMenu: function(e) {
    e.preventDefault();
    e.stopPropagation();
    ui.dispatch(["setActiveUIEditorElement", this.props.elem[0]]);
    ui.dispatch(["contextMenu", {e: {clientX: e.clientX, clientY: e.clientY},
                              items: this.contextMenuItems()}]);
  },
  isActive: function() {
    var active = ui.indexer.first("activeUIEditorElement");
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

// Stand alone components
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
module.exports.Resizer = Resizer;

// Tile components

var uiTile = reactFactory({
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
      var attrs = ui.indexer.index("uiEditorElementAttr", "collector", [0, 1])[this.props.elem[0]];
      var text = "";
      if(attrs && attrs["text"]) {
        unpack [_, attr, field, isBinding] = attrs["text"][0];
        if(isBinding) {
          text = "Bound to " + ui.indexer.index("displayName", "lookup", [0, 1])[field];
        } else {
          text = field;
        }
      }
      return ["span", opts, text];
    }
  }),
  button: reactFactory({
    mixins: [uiEditorElementMixin, ui.mixin.contentEditable],
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
      ui.dispatch(["setUIElementText", this.state.edit]);
    },
    element: function() {
      var attrs = ui.indexer.index("uiEditorElementAttr", "collector", [0, 1])[this.props.elem[0]];
      var text = "";
      if(attrs && attrs["text"]) {
        unpack [_, attr, field, isBinding] = attrs["text"][0];
        if(isBinding) {
          text = "Bound to " + ui.indexer.index("displayName", "lookup", [0, 1])[field];
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
    var mode = ui.indexer.index("uiEditorMode", "lookup", [0, 1])[this.props.tile] || "designer";
    if(mode === "designer") {
      ui.dispatch(["contextMenu", {e: {clientX: e.clientX, clientY: e.clientY},
                                items: [
                                  [0, "text", "Live view", "liveUIMode", this.props.tile],
                                  [1, "text", "box", "addUIEditorElementFromMenu", "box"],
                                  [2, "text", "text", "addUIEditorElementFromMenu", "text"],
                                  [3, "text", "button", "addUIEditorElementFromMenu", "button"],
                                  [4, "text", "input", "addUIEditorElementFromMenu", "input"]
                                ]}]);
    } else {
      ui.dispatch(["contextMenu", {e: {clientX: e.clientX, clientY: e.clientY},
                                items: [
                                  [0, "text", "Designer", "designerUIMode", this.props.tile]
                                ]}]);
    }
  },
  render: function() {
    var self = this;
    var mode = ui.indexer.index("uiEditorMode", "lookup", [0, 1])[this.props.tile] || "designer";
    var switcherClick = function(mode) {
      return function(e) {
        ui.dispatch([mode, self.props.tile]);
      }
    }
    var switcher = JSML.react(["div", {className: "switcher"},
                               ["span", {className: mode === "designer" ? "active" : "", onClick: switcherClick("designerUIMode")}, "designer"],
                               ["span", {className: mode === "live" ? "active" : "", onClick: switcherClick("liveUIMode")},"live"]])
    if(mode === "designer") {
      var self = this;
      var editorElems = ui.indexer.facts("uiEditorElement").map(function(cur) {
        unpack [id, type] = cur;
        return self[type]({elem: cur, tile: self.props.tile, key: id});
      });
      var content = [switcher,
                     JSML.react(["div", {className: "ui-design-surface"},
                                 editorElems])];
    } else {
      var content = [switcher, this.container({})];
    }

    return ui.tileWrapper({class: "ui-tile", controls: false, content: content, contextMenu: this.contextMenu,
                          pos: this.props.pos, size: this.props.size, tile: this.props.tile});
  }
});
ui.registerTile("ui", uiTile);
