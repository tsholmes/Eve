(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE

// Utility function that allows modes to be combined. The mode given
// as the base argument takes care of most of the normal mode
// functionality, but a second (typically simple) mode is used, which
// can override the style of text. Both modes get to parse all of the
// text, but when both assign a non-null style to a piece of code, the
// overlay wins, unless the combine argument was true and not overridden,
// or state.overlay.combineTokens was true, in which case the styles are
// combined.

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    mod(require("../../lib/codemirror"));
  else if (typeof define == "function" && define.amd) // AMD
    define(["../../lib/codemirror"], mod);
  else // Plain browser env
    mod(CodeMirror);
})(function(CodeMirror) {
"use strict";

CodeMirror.overlayMode = function(base, overlay, combine) {
  return {
    startState: function() {
      return {
        base: CodeMirror.startState(base),
        overlay: CodeMirror.startState(overlay),
        basePos: 0, baseCur: null,
        overlayPos: 0, overlayCur: null,
        streamSeen: null
      };
    },
    copyState: function(state) {
      return {
        base: CodeMirror.copyState(base, state.base),
        overlay: CodeMirror.copyState(overlay, state.overlay),
        basePos: state.basePos, baseCur: null,
        overlayPos: state.overlayPos, overlayCur: null
      };
    },

    token: function(stream, state) {
      if (stream != state.streamSeen ||
          Math.min(state.basePos, state.overlayPos) < stream.start) {
        state.streamSeen = stream;
        state.basePos = state.overlayPos = stream.start;
      }

      if (stream.start == state.basePos) {
        state.baseCur = base.token(stream, state.base);
        state.basePos = stream.pos;
      }
      if (stream.start == state.overlayPos) {
        stream.pos = stream.start;
        state.overlayCur = overlay.token(stream, state.overlay);
        state.overlayPos = stream.pos;
      }
      stream.pos = Math.min(state.basePos, state.overlayPos);

      // state.overlay.combineTokens always takes precedence over combine,
      // unless set to null
      if (state.overlayCur == null) return state.baseCur;
      else if (state.baseCur != null &&
               state.overlay.combineTokens ||
               combine && state.overlay.combineTokens == null)
        return state.baseCur + " " + state.overlayCur;
      else return state.overlayCur;
    },

    indent: base.indent && function(state, textAfter) {
      return base.indent(state.base, textAfter);
    },
    electricChars: base.electricChars,

    innerMode: function(state) { return {state: state.base, mode: base}; },

    blankLine: function(state) {
      if (base.blankLine) base.blankLine(state.base);
      if (overlay.blankLine) overlay.blankLine(state.overlay);
    }
  };
};

});

},{"../../lib/codemirror":2}],2:[function(require,module,exports){
// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE

// This is CodeMirror (http://codemirror.net), a code editor
// implemented in JavaScript on top of the browser's DOM.
//
// You can find some technical background for some of the code below
// at http://marijnhaverbeke.nl/blog/#cm-internals .

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    module.exports = mod();
  else if (typeof define == "function" && define.amd) // AMD
    return define([], mod);
  else // Plain browser env
    this.CodeMirror = mod();
})(function() {
  "use strict";

  // BROWSER SNIFFING

  // Kludges for bugs and behavior differences that can't be feature
  // detected are enabled based on userAgent etc sniffing.
  var userAgent = navigator.userAgent;
  var platform = navigator.platform;

  var gecko = /gecko\/\d/i.test(userAgent);
  var ie_upto10 = /MSIE \d/.test(userAgent);
  var ie_11up = /Trident\/(?:[7-9]|\d{2,})\..*rv:(\d+)/.exec(userAgent);
  var ie = ie_upto10 || ie_11up;
  var ie_version = ie && (ie_upto10 ? document.documentMode || 6 : ie_11up[1]);
  var webkit = /WebKit\//.test(userAgent);
  var qtwebkit = webkit && /Qt\/\d+\.\d+/.test(userAgent);
  var chrome = /Chrome\//.test(userAgent);
  var presto = /Opera\//.test(userAgent);
  var safari = /Apple Computer/.test(navigator.vendor);
  var mac_geMountainLion = /Mac OS X 1\d\D([8-9]|\d\d)\D/.test(userAgent);
  var phantom = /PhantomJS/.test(userAgent);

  var ios = /AppleWebKit/.test(userAgent) && /Mobile\/\w+/.test(userAgent);
  // This is woefully incomplete. Suggestions for alternative methods welcome.
  var mobile = ios || /Android|webOS|BlackBerry|Opera Mini|Opera Mobi|IEMobile/i.test(userAgent);
  var mac = ios || /Mac/.test(platform);
  var windows = /win/i.test(platform);

  var presto_version = presto && userAgent.match(/Version\/(\d*\.\d*)/);
  if (presto_version) presto_version = Number(presto_version[1]);
  if (presto_version && presto_version >= 15) { presto = false; webkit = true; }
  // Some browsers use the wrong event properties to signal cmd/ctrl on OS X
  var flipCtrlCmd = mac && (qtwebkit || presto && (presto_version == null || presto_version < 12.11));
  var captureRightClick = gecko || (ie && ie_version >= 9);

  // Optimize some code when these features are not used.
  var sawReadOnlySpans = false, sawCollapsedSpans = false;

  // EDITOR CONSTRUCTOR

  // A CodeMirror instance represents an editor. This is the object
  // that user code is usually dealing with.

  function CodeMirror(place, options) {
    if (!(this instanceof CodeMirror)) return new CodeMirror(place, options);

    this.options = options = options ? copyObj(options) : {};
    // Determine effective options based on given values and defaults.
    copyObj(defaults, options, false);
    setGuttersForLineNumbers(options);

    var doc = options.value;
    if (typeof doc == "string") doc = new Doc(doc, options.mode, null, options.lineSeparator);
    this.doc = doc;

    var input = new CodeMirror.inputStyles[options.inputStyle](this);
    var display = this.display = new Display(place, doc, input);
    display.wrapper.CodeMirror = this;
    updateGutters(this);
    themeChanged(this);
    if (options.lineWrapping)
      this.display.wrapper.className += " CodeMirror-wrap";
    if (options.autofocus && !mobile) display.input.focus();
    initScrollbars(this);

    this.state = {
      keyMaps: [],  // stores maps added by addKeyMap
      overlays: [], // highlighting overlays, as added by addOverlay
      modeGen: 0,   // bumped when mode/overlay changes, used to invalidate highlighting info
      overwrite: false,
      delayingBlurEvent: false,
      focused: false,
      suppressEdits: false, // used to disable editing during key handlers when in readOnly mode
      pasteIncoming: false, cutIncoming: false, // help recognize paste/cut edits in input.poll
      selectingText: false,
      draggingText: false,
      highlight: new Delayed(), // stores highlight worker timeout
      keySeq: null,  // Unfinished key sequence
      specialChars: null
    };

    var cm = this;

    // Override magic textarea content restore that IE sometimes does
    // on our hidden textarea on reload
    if (ie && ie_version < 11) setTimeout(function() { cm.display.input.reset(true); }, 20);

    registerEventHandlers(this);
    ensureGlobalHandlers();

    startOperation(this);
    this.curOp.forceUpdate = true;
    attachDoc(this, doc);

    if ((options.autofocus && !mobile) || cm.hasFocus())
      setTimeout(bind(onFocus, this), 20);
    else
      onBlur(this);

    for (var opt in optionHandlers) if (optionHandlers.hasOwnProperty(opt))
      optionHandlers[opt](this, options[opt], Init);
    maybeUpdateLineNumberWidth(this);
    if (options.finishInit) options.finishInit(this);
    for (var i = 0; i < initHooks.length; ++i) initHooks[i](this);
    endOperation(this);
    // Suppress optimizelegibility in Webkit, since it breaks text
    // measuring on line wrapping boundaries.
    if (webkit && options.lineWrapping &&
        getComputedStyle(display.lineDiv).textRendering == "optimizelegibility")
      display.lineDiv.style.textRendering = "auto";
  }

  // DISPLAY CONSTRUCTOR

  // The display handles the DOM integration, both for input reading
  // and content drawing. It holds references to DOM nodes and
  // display-related state.

  function Display(place, doc, input) {
    var d = this;
    this.input = input;

    // Covers bottom-right square when both scrollbars are present.
    d.scrollbarFiller = elt("div", null, "CodeMirror-scrollbar-filler");
    d.scrollbarFiller.setAttribute("cm-not-content", "true");
    // Covers bottom of gutter when coverGutterNextToScrollbar is on
    // and h scrollbar is present.
    d.gutterFiller = elt("div", null, "CodeMirror-gutter-filler");
    d.gutterFiller.setAttribute("cm-not-content", "true");
    // Will contain the actual code, positioned to cover the viewport.
    d.lineDiv = elt("div", null, "CodeMirror-code");
    // Elements are added to these to represent selection and cursors.
    d.selectionDiv = elt("div", null, null, "position: relative; z-index: 1");
    d.cursorDiv = elt("div", null, "CodeMirror-cursors");
    // A visibility: hidden element used to find the size of things.
    d.measure = elt("div", null, "CodeMirror-measure");
    // When lines outside of the viewport are measured, they are drawn in this.
    d.lineMeasure = elt("div", null, "CodeMirror-measure");
    // Wraps everything that needs to exist inside the vertically-padded coordinate system
    d.lineSpace = elt("div", [d.measure, d.lineMeasure, d.selectionDiv, d.cursorDiv, d.lineDiv],
                      null, "position: relative; outline: none");
    // Moved around its parent to cover visible view.
    d.mover = elt("div", [elt("div", [d.lineSpace], "CodeMirror-lines")], null, "position: relative");
    // Set to the height of the document, allowing scrolling.
    d.sizer = elt("div", [d.mover], "CodeMirror-sizer");
    d.sizerWidth = null;
    // Behavior of elts with overflow: auto and padding is
    // inconsistent across browsers. This is used to ensure the
    // scrollable area is big enough.
    d.heightForcer = elt("div", null, null, "position: absolute; height: " + scrollerGap + "px; width: 1px;");
    // Will contain the gutters, if any.
    d.gutters = elt("div", null, "CodeMirror-gutters");
    d.lineGutter = null;
    // Actual scrollable element.
    d.scroller = elt("div", [d.sizer, d.heightForcer, d.gutters], "CodeMirror-scroll");
    d.scroller.setAttribute("tabIndex", "-1");
    // The element in which the editor lives.
    d.wrapper = elt("div", [d.scrollbarFiller, d.gutterFiller, d.scroller], "CodeMirror");

    // Work around IE7 z-index bug (not perfect, hence IE7 not really being supported)
    if (ie && ie_version < 8) { d.gutters.style.zIndex = -1; d.scroller.style.paddingRight = 0; }
    if (!webkit && !(gecko && mobile)) d.scroller.draggable = true;

    if (place) {
      if (place.appendChild) place.appendChild(d.wrapper);
      else place(d.wrapper);
    }

    // Current rendered range (may be bigger than the view window).
    d.viewFrom = d.viewTo = doc.first;
    d.reportedViewFrom = d.reportedViewTo = doc.first;
    // Information about the rendered lines.
    d.view = [];
    d.renderedView = null;
    // Holds info about a single rendered line when it was rendered
    // for measurement, while not in view.
    d.externalMeasured = null;
    // Empty space (in pixels) above the view
    d.viewOffset = 0;
    d.lastWrapHeight = d.lastWrapWidth = 0;
    d.updateLineNumbers = null;

    d.nativeBarWidth = d.barHeight = d.barWidth = 0;
    d.scrollbarsClipped = false;

    // Used to only resize the line number gutter when necessary (when
    // the amount of lines crosses a boundary that makes its width change)
    d.lineNumWidth = d.lineNumInnerWidth = d.lineNumChars = null;
    // Set to true when a non-horizontal-scrolling line widget is
    // added. As an optimization, line widget aligning is skipped when
    // this is false.
    d.alignWidgets = false;

    d.cachedCharWidth = d.cachedTextHeight = d.cachedPaddingH = null;

    // Tracks the maximum line length so that the horizontal scrollbar
    // can be kept static when scrolling.
    d.maxLine = null;
    d.maxLineLength = 0;
    d.maxLineChanged = false;

    // Used for measuring wheel scrolling granularity
    d.wheelDX = d.wheelDY = d.wheelStartX = d.wheelStartY = null;

    // True when shift is held down.
    d.shift = false;

    // Used to track whether anything happened since the context menu
    // was opened.
    d.selForContextMenu = null;

    d.activeTouch = null;

    input.init(d);
  }

  // STATE UPDATES

  // Used to get the editor into a consistent state again when options change.

  function loadMode(cm) {
    cm.doc.mode = CodeMirror.getMode(cm.options, cm.doc.modeOption);
    resetModeState(cm);
  }

  function resetModeState(cm) {
    cm.doc.iter(function(line) {
      if (line.stateAfter) line.stateAfter = null;
      if (line.styles) line.styles = null;
    });
    cm.doc.frontier = cm.doc.first;
    startWorker(cm, 100);
    cm.state.modeGen++;
    if (cm.curOp) regChange(cm);
  }

  function wrappingChanged(cm) {
    if (cm.options.lineWrapping) {
      addClass(cm.display.wrapper, "CodeMirror-wrap");
      cm.display.sizer.style.minWidth = "";
      cm.display.sizerWidth = null;
    } else {
      rmClass(cm.display.wrapper, "CodeMirror-wrap");
      findMaxLine(cm);
    }
    estimateLineHeights(cm);
    regChange(cm);
    clearCaches(cm);
    setTimeout(function(){updateScrollbars(cm);}, 100);
  }

  // Returns a function that estimates the height of a line, to use as
  // first approximation until the line becomes visible (and is thus
  // properly measurable).
  function estimateHeight(cm) {
    var th = textHeight(cm.display), wrapping = cm.options.lineWrapping;
    var perLine = wrapping && Math.max(5, cm.display.scroller.clientWidth / charWidth(cm.display) - 3);
    return function(line) {
      if (lineIsHidden(cm.doc, line)) return 0;

      var widgetsHeight = 0;
      if (line.widgets) for (var i = 0; i < line.widgets.length; i++) {
        if (line.widgets[i].height) widgetsHeight += line.widgets[i].height;
      }

      if (wrapping)
        return widgetsHeight + (Math.ceil(line.text.length / perLine) || 1) * th;
      else
        return widgetsHeight + th;
    };
  }

  function estimateLineHeights(cm) {
    var doc = cm.doc, est = estimateHeight(cm);
    doc.iter(function(line) {
      var estHeight = est(line);
      if (estHeight != line.height) updateLineHeight(line, estHeight);
    });
  }

  function themeChanged(cm) {
    cm.display.wrapper.className = cm.display.wrapper.className.replace(/\s*cm-s-\S+/g, "") +
      cm.options.theme.replace(/(^|\s)\s*/g, " cm-s-");
    clearCaches(cm);
  }

  function guttersChanged(cm) {
    updateGutters(cm);
    regChange(cm);
    setTimeout(function(){alignHorizontally(cm);}, 20);
  }

  // Rebuild the gutter elements, ensure the margin to the left of the
  // code matches their width.
  function updateGutters(cm) {
    var gutters = cm.display.gutters, specs = cm.options.gutters;
    removeChildren(gutters);
    for (var i = 0; i < specs.length; ++i) {
      var gutterClass = specs[i];
      var gElt = gutters.appendChild(elt("div", null, "CodeMirror-gutter " + gutterClass));
      if (gutterClass == "CodeMirror-linenumbers") {
        cm.display.lineGutter = gElt;
        gElt.style.width = (cm.display.lineNumWidth || 1) + "px";
      }
    }
    gutters.style.display = i ? "" : "none";
    updateGutterSpace(cm);
  }

  function updateGutterSpace(cm) {
    var width = cm.display.gutters.offsetWidth;
    cm.display.sizer.style.marginLeft = width + "px";
  }

  // Compute the character length of a line, taking into account
  // collapsed ranges (see markText) that might hide parts, and join
  // other lines onto it.
  function lineLength(line) {
    if (line.height == 0) return 0;
    var len = line.text.length, merged, cur = line;
    while (merged = collapsedSpanAtStart(cur)) {
      var found = merged.find(0, true);
      cur = found.from.line;
      len += found.from.ch - found.to.ch;
    }
    cur = line;
    while (merged = collapsedSpanAtEnd(cur)) {
      var found = merged.find(0, true);
      len -= cur.text.length - found.from.ch;
      cur = found.to.line;
      len += cur.text.length - found.to.ch;
    }
    return len;
  }

  // Find the longest line in the document.
  function findMaxLine(cm) {
    var d = cm.display, doc = cm.doc;
    d.maxLine = getLine(doc, doc.first);
    d.maxLineLength = lineLength(d.maxLine);
    d.maxLineChanged = true;
    doc.iter(function(line) {
      var len = lineLength(line);
      if (len > d.maxLineLength) {
        d.maxLineLength = len;
        d.maxLine = line;
      }
    });
  }

  // Make sure the gutters options contains the element
  // "CodeMirror-linenumbers" when the lineNumbers option is true.
  function setGuttersForLineNumbers(options) {
    var found = indexOf(options.gutters, "CodeMirror-linenumbers");
    if (found == -1 && options.lineNumbers) {
      options.gutters = options.gutters.concat(["CodeMirror-linenumbers"]);
    } else if (found > -1 && !options.lineNumbers) {
      options.gutters = options.gutters.slice(0);
      options.gutters.splice(found, 1);
    }
  }

  // SCROLLBARS

  // Prepare DOM reads needed to update the scrollbars. Done in one
  // shot to minimize update/measure roundtrips.
  function measureForScrollbars(cm) {
    var d = cm.display, gutterW = d.gutters.offsetWidth;
    var docH = Math.round(cm.doc.height + paddingVert(cm.display));
    return {
      clientHeight: d.scroller.clientHeight,
      viewHeight: d.wrapper.clientHeight,
      scrollWidth: d.scroller.scrollWidth, clientWidth: d.scroller.clientWidth,
      viewWidth: d.wrapper.clientWidth,
      barLeft: cm.options.fixedGutter ? gutterW : 0,
      docHeight: docH,
      scrollHeight: docH + scrollGap(cm) + d.barHeight,
      nativeBarWidth: d.nativeBarWidth,
      gutterWidth: gutterW
    };
  }

  function NativeScrollbars(place, scroll, cm) {
    this.cm = cm;
    var vert = this.vert = elt("div", [elt("div", null, null, "min-width: 1px")], "CodeMirror-vscrollbar");
    var horiz = this.horiz = elt("div", [elt("div", null, null, "height: 100%; min-height: 1px")], "CodeMirror-hscrollbar");
    place(vert); place(horiz);

    on(vert, "scroll", function() {
      if (vert.clientHeight) scroll(vert.scrollTop, "vertical");
    });
    on(horiz, "scroll", function() {
      if (horiz.clientWidth) scroll(horiz.scrollLeft, "horizontal");
    });

    this.checkedOverlay = false;
    // Need to set a minimum width to see the scrollbar on IE7 (but must not set it on IE8).
    if (ie && ie_version < 8) this.horiz.style.minHeight = this.vert.style.minWidth = "18px";
  }

  NativeScrollbars.prototype = copyObj({
    update: function(measure) {
      var needsH = measure.scrollWidth > measure.clientWidth + 1;
      var needsV = measure.scrollHeight > measure.clientHeight + 1;
      var sWidth = measure.nativeBarWidth;

      if (needsV) {
        this.vert.style.display = "block";
        this.vert.style.bottom = needsH ? sWidth + "px" : "0";
        var totalHeight = measure.viewHeight - (needsH ? sWidth : 0);
        // A bug in IE8 can cause this value to be negative, so guard it.
        this.vert.firstChild.style.height =
          Math.max(0, measure.scrollHeight - measure.clientHeight + totalHeight) + "px";
      } else {
        this.vert.style.display = "";
        this.vert.firstChild.style.height = "0";
      }

      if (needsH) {
        this.horiz.style.display = "block";
        this.horiz.style.right = needsV ? sWidth + "px" : "0";
        this.horiz.style.left = measure.barLeft + "px";
        var totalWidth = measure.viewWidth - measure.barLeft - (needsV ? sWidth : 0);
        this.horiz.firstChild.style.width =
          (measure.scrollWidth - measure.clientWidth + totalWidth) + "px";
      } else {
        this.horiz.style.display = "";
        this.horiz.firstChild.style.width = "0";
      }

      if (!this.checkedOverlay && measure.clientHeight > 0) {
        if (sWidth == 0) this.overlayHack();
        this.checkedOverlay = true;
      }

      return {right: needsV ? sWidth : 0, bottom: needsH ? sWidth : 0};
    },
    setScrollLeft: function(pos) {
      if (this.horiz.scrollLeft != pos) this.horiz.scrollLeft = pos;
    },
    setScrollTop: function(pos) {
      if (this.vert.scrollTop != pos) this.vert.scrollTop = pos;
    },
    overlayHack: function() {
      var w = mac && !mac_geMountainLion ? "12px" : "18px";
      this.horiz.style.minHeight = this.vert.style.minWidth = w;
      var self = this;
      var barMouseDown = function(e) {
        if (e_target(e) != self.vert && e_target(e) != self.horiz)
          operation(self.cm, onMouseDown)(e);
      };
      on(this.vert, "mousedown", barMouseDown);
      on(this.horiz, "mousedown", barMouseDown);
    },
    clear: function() {
      var parent = this.horiz.parentNode;
      parent.removeChild(this.horiz);
      parent.removeChild(this.vert);
    }
  }, NativeScrollbars.prototype);

  function NullScrollbars() {}

  NullScrollbars.prototype = copyObj({
    update: function() { return {bottom: 0, right: 0}; },
    setScrollLeft: function() {},
    setScrollTop: function() {},
    clear: function() {}
  }, NullScrollbars.prototype);

  CodeMirror.scrollbarModel = {"native": NativeScrollbars, "null": NullScrollbars};

  function initScrollbars(cm) {
    if (cm.display.scrollbars) {
      cm.display.scrollbars.clear();
      if (cm.display.scrollbars.addClass)
        rmClass(cm.display.wrapper, cm.display.scrollbars.addClass);
    }

    cm.display.scrollbars = new CodeMirror.scrollbarModel[cm.options.scrollbarStyle](function(node) {
      cm.display.wrapper.insertBefore(node, cm.display.scrollbarFiller);
      // Prevent clicks in the scrollbars from killing focus
      on(node, "mousedown", function() {
        if (cm.state.focused) setTimeout(function() { cm.display.input.focus(); }, 0);
      });
      node.setAttribute("cm-not-content", "true");
    }, function(pos, axis) {
      if (axis == "horizontal") setScrollLeft(cm, pos);
      else setScrollTop(cm, pos);
    }, cm);
    if (cm.display.scrollbars.addClass)
      addClass(cm.display.wrapper, cm.display.scrollbars.addClass);
  }

  function updateScrollbars(cm, measure) {
    if (!measure) measure = measureForScrollbars(cm);
    var startWidth = cm.display.barWidth, startHeight = cm.display.barHeight;
    updateScrollbarsInner(cm, measure);
    for (var i = 0; i < 4 && startWidth != cm.display.barWidth || startHeight != cm.display.barHeight; i++) {
      if (startWidth != cm.display.barWidth && cm.options.lineWrapping)
        updateHeightsInViewport(cm);
      updateScrollbarsInner(cm, measureForScrollbars(cm));
      startWidth = cm.display.barWidth; startHeight = cm.display.barHeight;
    }
  }

  // Re-synchronize the fake scrollbars with the actual size of the
  // content.
  function updateScrollbarsInner(cm, measure) {
    var d = cm.display;
    var sizes = d.scrollbars.update(measure);

    d.sizer.style.paddingRight = (d.barWidth = sizes.right) + "px";
    d.sizer.style.paddingBottom = (d.barHeight = sizes.bottom) + "px";

    if (sizes.right && sizes.bottom) {
      d.scrollbarFiller.style.display = "block";
      d.scrollbarFiller.style.height = sizes.bottom + "px";
      d.scrollbarFiller.style.width = sizes.right + "px";
    } else d.scrollbarFiller.style.display = "";
    if (sizes.bottom && cm.options.coverGutterNextToScrollbar && cm.options.fixedGutter) {
      d.gutterFiller.style.display = "block";
      d.gutterFiller.style.height = sizes.bottom + "px";
      d.gutterFiller.style.width = measure.gutterWidth + "px";
    } else d.gutterFiller.style.display = "";
  }

  // Compute the lines that are visible in a given viewport (defaults
  // the the current scroll position). viewport may contain top,
  // height, and ensure (see op.scrollToPos) properties.
  function visibleLines(display, doc, viewport) {
    var top = viewport && viewport.top != null ? Math.max(0, viewport.top) : display.scroller.scrollTop;
    top = Math.floor(top - paddingTop(display));
    var bottom = viewport && viewport.bottom != null ? viewport.bottom : top + display.wrapper.clientHeight;

    var from = lineAtHeight(doc, top), to = lineAtHeight(doc, bottom);
    // Ensure is a {from: {line, ch}, to: {line, ch}} object, and
    // forces those lines into the viewport (if possible).
    if (viewport && viewport.ensure) {
      var ensureFrom = viewport.ensure.from.line, ensureTo = viewport.ensure.to.line;
      if (ensureFrom < from) {
        from = ensureFrom;
        to = lineAtHeight(doc, heightAtLine(getLine(doc, ensureFrom)) + display.wrapper.clientHeight);
      } else if (Math.min(ensureTo, doc.lastLine()) >= to) {
        from = lineAtHeight(doc, heightAtLine(getLine(doc, ensureTo)) - display.wrapper.clientHeight);
        to = ensureTo;
      }
    }
    return {from: from, to: Math.max(to, from + 1)};
  }

  // LINE NUMBERS

  // Re-align line numbers and gutter marks to compensate for
  // horizontal scrolling.
  function alignHorizontally(cm) {
    var display = cm.display, view = display.view;
    if (!display.alignWidgets && (!display.gutters.firstChild || !cm.options.fixedGutter)) return;
    var comp = compensateForHScroll(display) - display.scroller.scrollLeft + cm.doc.scrollLeft;
    var gutterW = display.gutters.offsetWidth, left = comp + "px";
    for (var i = 0; i < view.length; i++) if (!view[i].hidden) {
      if (cm.options.fixedGutter && view[i].gutter)
        view[i].gutter.style.left = left;
      var align = view[i].alignable;
      if (align) for (var j = 0; j < align.length; j++)
        align[j].style.left = left;
    }
    if (cm.options.fixedGutter)
      display.gutters.style.left = (comp + gutterW) + "px";
  }

  // Used to ensure that the line number gutter is still the right
  // size for the current document size. Returns true when an update
  // is needed.
  function maybeUpdateLineNumberWidth(cm) {
    if (!cm.options.lineNumbers) return false;
    var doc = cm.doc, last = lineNumberFor(cm.options, doc.first + doc.size - 1), display = cm.display;
    if (last.length != display.lineNumChars) {
      var test = display.measure.appendChild(elt("div", [elt("div", last)],
                                                 "CodeMirror-linenumber CodeMirror-gutter-elt"));
      var innerW = test.firstChild.offsetWidth, padding = test.offsetWidth - innerW;
      display.lineGutter.style.width = "";
      display.lineNumInnerWidth = Math.max(innerW, display.lineGutter.offsetWidth - padding) + 1;
      display.lineNumWidth = display.lineNumInnerWidth + padding;
      display.lineNumChars = display.lineNumInnerWidth ? last.length : -1;
      display.lineGutter.style.width = display.lineNumWidth + "px";
      updateGutterSpace(cm);
      return true;
    }
    return false;
  }

  function lineNumberFor(options, i) {
    return String(options.lineNumberFormatter(i + options.firstLineNumber));
  }

  // Computes display.scroller.scrollLeft + display.gutters.offsetWidth,
  // but using getBoundingClientRect to get a sub-pixel-accurate
  // result.
  function compensateForHScroll(display) {
    return display.scroller.getBoundingClientRect().left - display.sizer.getBoundingClientRect().left;
  }

  // DISPLAY DRAWING

  function DisplayUpdate(cm, viewport, force) {
    var display = cm.display;

    this.viewport = viewport;
    // Store some values that we'll need later (but don't want to force a relayout for)
    this.visible = visibleLines(display, cm.doc, viewport);
    this.editorIsHidden = !display.wrapper.offsetWidth;
    this.wrapperHeight = display.wrapper.clientHeight;
    this.wrapperWidth = display.wrapper.clientWidth;
    this.oldDisplayWidth = displayWidth(cm);
    this.force = force;
    this.dims = getDimensions(cm);
    this.events = [];
  }

  DisplayUpdate.prototype.signal = function(emitter, type) {
    if (hasHandler(emitter, type))
      this.events.push(arguments);
  };
  DisplayUpdate.prototype.finish = function() {
    for (var i = 0; i < this.events.length; i++)
      signal.apply(null, this.events[i]);
  };

  function maybeClipScrollbars(cm) {
    var display = cm.display;
    if (!display.scrollbarsClipped && display.scroller.offsetWidth) {
      display.nativeBarWidth = display.scroller.offsetWidth - display.scroller.clientWidth;
      display.heightForcer.style.height = scrollGap(cm) + "px";
      display.sizer.style.marginBottom = -display.nativeBarWidth + "px";
      display.sizer.style.borderRightWidth = scrollGap(cm) + "px";
      display.scrollbarsClipped = true;
    }
  }

  // Does the actual updating of the line display. Bails out
  // (returning false) when there is nothing to be done and forced is
  // false.
  function updateDisplayIfNeeded(cm, update) {
    var display = cm.display, doc = cm.doc;

    if (update.editorIsHidden) {
      resetView(cm);
      return false;
    }

    // Bail out if the visible area is already rendered and nothing changed.
    if (!update.force &&
        update.visible.from >= display.viewFrom && update.visible.to <= display.viewTo &&
        (display.updateLineNumbers == null || display.updateLineNumbers >= display.viewTo) &&
        display.renderedView == display.view && countDirtyView(cm) == 0)
      return false;

    if (maybeUpdateLineNumberWidth(cm)) {
      resetView(cm);
      update.dims = getDimensions(cm);
    }

    // Compute a suitable new viewport (from & to)
    var end = doc.first + doc.size;
    var from = Math.max(update.visible.from - cm.options.viewportMargin, doc.first);
    var to = Math.min(end, update.visible.to + cm.options.viewportMargin);
    if (display.viewFrom < from && from - display.viewFrom < 20) from = Math.max(doc.first, display.viewFrom);
    if (display.viewTo > to && display.viewTo - to < 20) to = Math.min(end, display.viewTo);
    if (sawCollapsedSpans) {
      from = visualLineNo(cm.doc, from);
      to = visualLineEndNo(cm.doc, to);
    }

    var different = from != display.viewFrom || to != display.viewTo ||
      display.lastWrapHeight != update.wrapperHeight || display.lastWrapWidth != update.wrapperWidth;
    adjustView(cm, from, to);

    display.viewOffset = heightAtLine(getLine(cm.doc, display.viewFrom));
    // Position the mover div to align with the current scroll position
    cm.display.mover.style.top = display.viewOffset + "px";

    var toUpdate = countDirtyView(cm);
    if (!different && toUpdate == 0 && !update.force && display.renderedView == display.view &&
        (display.updateLineNumbers == null || display.updateLineNumbers >= display.viewTo))
      return false;

    // For big changes, we hide the enclosing element during the
    // update, since that speeds up the operations on most browsers.
    var focused = activeElt();
    if (toUpdate > 4) display.lineDiv.style.display = "none";
    patchDisplay(cm, display.updateLineNumbers, update.dims);
    if (toUpdate > 4) display.lineDiv.style.display = "";
    display.renderedView = display.view;
    // There might have been a widget with a focused element that got
    // hidden or updated, if so re-focus it.
    if (focused && activeElt() != focused && focused.offsetHeight) focused.focus();

    // Prevent selection and cursors from interfering with the scroll
    // width and height.
    removeChildren(display.cursorDiv);
    removeChildren(display.selectionDiv);
    display.gutters.style.height = display.sizer.style.minHeight = 0;

    if (different) {
      display.lastWrapHeight = update.wrapperHeight;
      display.lastWrapWidth = update.wrapperWidth;
      startWorker(cm, 400);
    }

    display.updateLineNumbers = null;

    return true;
  }

  function postUpdateDisplay(cm, update) {
    var viewport = update.viewport;
    for (var first = true;; first = false) {
      if (!first || !cm.options.lineWrapping || update.oldDisplayWidth == displayWidth(cm)) {
        // Clip forced viewport to actual scrollable area.
        if (viewport && viewport.top != null)
          viewport = {top: Math.min(cm.doc.height + paddingVert(cm.display) - displayHeight(cm), viewport.top)};
        // Updated line heights might result in the drawn area not
        // actually covering the viewport. Keep looping until it does.
        update.visible = visibleLines(cm.display, cm.doc, viewport);
        if (update.visible.from >= cm.display.viewFrom && update.visible.to <= cm.display.viewTo)
          break;
      }
      if (!updateDisplayIfNeeded(cm, update)) break;
      updateHeightsInViewport(cm);
      var barMeasure = measureForScrollbars(cm);
      updateSelection(cm);
      setDocumentHeight(cm, barMeasure);
      updateScrollbars(cm, barMeasure);
    }

    update.signal(cm, "update", cm);
    if (cm.display.viewFrom != cm.display.reportedViewFrom || cm.display.viewTo != cm.display.reportedViewTo) {
      update.signal(cm, "viewportChange", cm, cm.display.viewFrom, cm.display.viewTo);
      cm.display.reportedViewFrom = cm.display.viewFrom; cm.display.reportedViewTo = cm.display.viewTo;
    }
  }

  function updateDisplaySimple(cm, viewport) {
    var update = new DisplayUpdate(cm, viewport);
    if (updateDisplayIfNeeded(cm, update)) {
      updateHeightsInViewport(cm);
      postUpdateDisplay(cm, update);
      var barMeasure = measureForScrollbars(cm);
      updateSelection(cm);
      setDocumentHeight(cm, barMeasure);
      updateScrollbars(cm, barMeasure);
      update.finish();
    }
  }

  function setDocumentHeight(cm, measure) {
    cm.display.sizer.style.minHeight = measure.docHeight + "px";
    var total = measure.docHeight + cm.display.barHeight;
    cm.display.heightForcer.style.top = total + "px";
    cm.display.gutters.style.height = Math.max(total + scrollGap(cm), measure.clientHeight) + "px";
  }

  // Read the actual heights of the rendered lines, and update their
  // stored heights to match.
  function updateHeightsInViewport(cm) {
    var display = cm.display;
    var prevBottom = display.lineDiv.offsetTop;
    for (var i = 0; i < display.view.length; i++) {
      var cur = display.view[i], height;
      if (cur.hidden) continue;
      if (ie && ie_version < 8) {
        var bot = cur.node.offsetTop + cur.node.offsetHeight;
        height = bot - prevBottom;
        prevBottom = bot;
      } else {
        var box = cur.node.getBoundingClientRect();
        height = box.bottom - box.top;
      }
      var diff = cur.line.height - height;
      if (height < 2) height = textHeight(display);
      if (diff > .001 || diff < -.001) {
        updateLineHeight(cur.line, height);
        updateWidgetHeight(cur.line);
        if (cur.rest) for (var j = 0; j < cur.rest.length; j++)
          updateWidgetHeight(cur.rest[j]);
      }
    }
  }

  // Read and store the height of line widgets associated with the
  // given line.
  function updateWidgetHeight(line) {
    if (line.widgets) for (var i = 0; i < line.widgets.length; ++i)
      line.widgets[i].height = line.widgets[i].node.offsetHeight;
  }

  // Do a bulk-read of the DOM positions and sizes needed to draw the
  // view, so that we don't interleave reading and writing to the DOM.
  function getDimensions(cm) {
    var d = cm.display, left = {}, width = {};
    var gutterLeft = d.gutters.clientLeft;
    for (var n = d.gutters.firstChild, i = 0; n; n = n.nextSibling, ++i) {
      left[cm.options.gutters[i]] = n.offsetLeft + n.clientLeft + gutterLeft;
      width[cm.options.gutters[i]] = n.clientWidth;
    }
    return {fixedPos: compensateForHScroll(d),
            gutterTotalWidth: d.gutters.offsetWidth,
            gutterLeft: left,
            gutterWidth: width,
            wrapperWidth: d.wrapper.clientWidth};
  }

  // Sync the actual display DOM structure with display.view, removing
  // nodes for lines that are no longer in view, and creating the ones
  // that are not there yet, and updating the ones that are out of
  // date.
  function patchDisplay(cm, updateNumbersFrom, dims) {
    var display = cm.display, lineNumbers = cm.options.lineNumbers;
    var container = display.lineDiv, cur = container.firstChild;

    function rm(node) {
      var next = node.nextSibling;
      // Works around a throw-scroll bug in OS X Webkit
      if (webkit && mac && cm.display.currentWheelTarget == node)
        node.style.display = "none";
      else
        node.parentNode.removeChild(node);
      return next;
    }

    var view = display.view, lineN = display.viewFrom;
    // Loop over the elements in the view, syncing cur (the DOM nodes
    // in display.lineDiv) with the view as we go.
    for (var i = 0; i < view.length; i++) {
      var lineView = view[i];
      if (lineView.hidden) {
      } else if (!lineView.node || lineView.node.parentNode != container) { // Not drawn yet
        var node = buildLineElement(cm, lineView, lineN, dims);
        container.insertBefore(node, cur);
      } else { // Already drawn
        while (cur != lineView.node) cur = rm(cur);
        var updateNumber = lineNumbers && updateNumbersFrom != null &&
          updateNumbersFrom <= lineN && lineView.lineNumber;
        if (lineView.changes) {
          if (indexOf(lineView.changes, "gutter") > -1) updateNumber = false;
          updateLineForChanges(cm, lineView, lineN, dims);
        }
        if (updateNumber) {
          removeChildren(lineView.lineNumber);
          lineView.lineNumber.appendChild(document.createTextNode(lineNumberFor(cm.options, lineN)));
        }
        cur = lineView.node.nextSibling;
      }
      lineN += lineView.size;
    }
    while (cur) cur = rm(cur);
  }

  // When an aspect of a line changes, a string is added to
  // lineView.changes. This updates the relevant part of the line's
  // DOM structure.
  function updateLineForChanges(cm, lineView, lineN, dims) {
    for (var j = 0; j < lineView.changes.length; j++) {
      var type = lineView.changes[j];
      if (type == "text") updateLineText(cm, lineView);
      else if (type == "gutter") updateLineGutter(cm, lineView, lineN, dims);
      else if (type == "class") updateLineClasses(lineView);
      else if (type == "widget") updateLineWidgets(cm, lineView, dims);
    }
    lineView.changes = null;
  }

  // Lines with gutter elements, widgets or a background class need to
  // be wrapped, and have the extra elements added to the wrapper div
  function ensureLineWrapped(lineView) {
    if (lineView.node == lineView.text) {
      lineView.node = elt("div", null, null, "position: relative");
      if (lineView.text.parentNode)
        lineView.text.parentNode.replaceChild(lineView.node, lineView.text);
      lineView.node.appendChild(lineView.text);
      if (ie && ie_version < 8) lineView.node.style.zIndex = 2;
    }
    return lineView.node;
  }

  function updateLineBackground(lineView) {
    var cls = lineView.bgClass ? lineView.bgClass + " " + (lineView.line.bgClass || "") : lineView.line.bgClass;
    if (cls) cls += " CodeMirror-linebackground";
    if (lineView.background) {
      if (cls) lineView.background.className = cls;
      else { lineView.background.parentNode.removeChild(lineView.background); lineView.background = null; }
    } else if (cls) {
      var wrap = ensureLineWrapped(lineView);
      lineView.background = wrap.insertBefore(elt("div", null, cls), wrap.firstChild);
    }
  }

  // Wrapper around buildLineContent which will reuse the structure
  // in display.externalMeasured when possible.
  function getLineContent(cm, lineView) {
    var ext = cm.display.externalMeasured;
    if (ext && ext.line == lineView.line) {
      cm.display.externalMeasured = null;
      lineView.measure = ext.measure;
      return ext.built;
    }
    return buildLineContent(cm, lineView);
  }

  // Redraw the line's text. Interacts with the background and text
  // classes because the mode may output tokens that influence these
  // classes.
  function updateLineText(cm, lineView) {
    var cls = lineView.text.className;
    var built = getLineContent(cm, lineView);
    if (lineView.text == lineView.node) lineView.node = built.pre;
    lineView.text.parentNode.replaceChild(built.pre, lineView.text);
    lineView.text = built.pre;
    if (built.bgClass != lineView.bgClass || built.textClass != lineView.textClass) {
      lineView.bgClass = built.bgClass;
      lineView.textClass = built.textClass;
      updateLineClasses(lineView);
    } else if (cls) {
      lineView.text.className = cls;
    }
  }

  function updateLineClasses(lineView) {
    updateLineBackground(lineView);
    if (lineView.line.wrapClass)
      ensureLineWrapped(lineView).className = lineView.line.wrapClass;
    else if (lineView.node != lineView.text)
      lineView.node.className = "";
    var textClass = lineView.textClass ? lineView.textClass + " " + (lineView.line.textClass || "") : lineView.line.textClass;
    lineView.text.className = textClass || "";
  }

  function updateLineGutter(cm, lineView, lineN, dims) {
    if (lineView.gutter) {
      lineView.node.removeChild(lineView.gutter);
      lineView.gutter = null;
    }
    if (lineView.gutterBackground) {
      lineView.node.removeChild(lineView.gutterBackground);
      lineView.gutterBackground = null;
    }
    if (lineView.line.gutterClass) {
      var wrap = ensureLineWrapped(lineView);
      lineView.gutterBackground = elt("div", null, "CodeMirror-gutter-background " + lineView.line.gutterClass,
                                      "left: " + (cm.options.fixedGutter ? dims.fixedPos : -dims.gutterTotalWidth) +
                                      "px; width: " + dims.gutterTotalWidth + "px");
      wrap.insertBefore(lineView.gutterBackground, lineView.text);
    }
    var markers = lineView.line.gutterMarkers;
    if (cm.options.lineNumbers || markers) {
      var wrap = ensureLineWrapped(lineView);
      var gutterWrap = lineView.gutter = elt("div", null, "CodeMirror-gutter-wrapper", "left: " +
                                             (cm.options.fixedGutter ? dims.fixedPos : -dims.gutterTotalWidth) + "px");
      cm.display.input.setUneditable(gutterWrap);
      wrap.insertBefore(gutterWrap, lineView.text);
      if (lineView.line.gutterClass)
        gutterWrap.className += " " + lineView.line.gutterClass;
      if (cm.options.lineNumbers && (!markers || !markers["CodeMirror-linenumbers"]))
        lineView.lineNumber = gutterWrap.appendChild(
          elt("div", lineNumberFor(cm.options, lineN),
              "CodeMirror-linenumber CodeMirror-gutter-elt",
              "left: " + dims.gutterLeft["CodeMirror-linenumbers"] + "px; width: "
              + cm.display.lineNumInnerWidth + "px"));
      if (markers) for (var k = 0; k < cm.options.gutters.length; ++k) {
        var id = cm.options.gutters[k], found = markers.hasOwnProperty(id) && markers[id];
        if (found)
          gutterWrap.appendChild(elt("div", [found], "CodeMirror-gutter-elt", "left: " +
                                     dims.gutterLeft[id] + "px; width: " + dims.gutterWidth[id] + "px"));
      }
    }
  }

  function updateLineWidgets(cm, lineView, dims) {
    if (lineView.alignable) lineView.alignable = null;
    for (var node = lineView.node.firstChild, next; node; node = next) {
      var next = node.nextSibling;
      if (node.className == "CodeMirror-linewidget")
        lineView.node.removeChild(node);
    }
    insertLineWidgets(cm, lineView, dims);
  }

  // Build a line's DOM representation from scratch
  function buildLineElement(cm, lineView, lineN, dims) {
    var built = getLineContent(cm, lineView);
    lineView.text = lineView.node = built.pre;
    if (built.bgClass) lineView.bgClass = built.bgClass;
    if (built.textClass) lineView.textClass = built.textClass;

    updateLineClasses(lineView);
    updateLineGutter(cm, lineView, lineN, dims);
    insertLineWidgets(cm, lineView, dims);
    return lineView.node;
  }

  // A lineView may contain multiple logical lines (when merged by
  // collapsed spans). The widgets for all of them need to be drawn.
  function insertLineWidgets(cm, lineView, dims) {
    insertLineWidgetsFor(cm, lineView.line, lineView, dims, true);
    if (lineView.rest) for (var i = 0; i < lineView.rest.length; i++)
      insertLineWidgetsFor(cm, lineView.rest[i], lineView, dims, false);
  }

  function insertLineWidgetsFor(cm, line, lineView, dims, allowAbove) {
    if (!line.widgets) return;
    var wrap = ensureLineWrapped(lineView);
    for (var i = 0, ws = line.widgets; i < ws.length; ++i) {
      var widget = ws[i], node = elt("div", [widget.node], "CodeMirror-linewidget");
      if (!widget.handleMouseEvents) node.setAttribute("cm-ignore-events", "true");
      positionLineWidget(widget, node, lineView, dims);
      cm.display.input.setUneditable(node);
      if (allowAbove && widget.above)
        wrap.insertBefore(node, lineView.gutter || lineView.text);
      else
        wrap.appendChild(node);
      signalLater(widget, "redraw");
    }
  }

  function positionLineWidget(widget, node, lineView, dims) {
    if (widget.noHScroll) {
      (lineView.alignable || (lineView.alignable = [])).push(node);
      var width = dims.wrapperWidth;
      node.style.left = dims.fixedPos + "px";
      if (!widget.coverGutter) {
        width -= dims.gutterTotalWidth;
        node.style.paddingLeft = dims.gutterTotalWidth + "px";
      }
      node.style.width = width + "px";
    }
    if (widget.coverGutter) {
      node.style.zIndex = 5;
      node.style.position = "relative";
      if (!widget.noHScroll) node.style.marginLeft = -dims.gutterTotalWidth + "px";
    }
  }

  // POSITION OBJECT

  // A Pos instance represents a position within the text.
  var Pos = CodeMirror.Pos = function(line, ch) {
    if (!(this instanceof Pos)) return new Pos(line, ch);
    this.line = line; this.ch = ch;
  };

  // Compare two positions, return 0 if they are the same, a negative
  // number when a is less, and a positive number otherwise.
  var cmp = CodeMirror.cmpPos = function(a, b) { return a.line - b.line || a.ch - b.ch; };

  function copyPos(x) {return Pos(x.line, x.ch);}
  function maxPos(a, b) { return cmp(a, b) < 0 ? b : a; }
  function minPos(a, b) { return cmp(a, b) < 0 ? a : b; }

  // INPUT HANDLING

  function ensureFocus(cm) {
    if (!cm.state.focused) { cm.display.input.focus(); onFocus(cm); }
  }

  function isReadOnly(cm) {
    return cm.options.readOnly || cm.doc.cantEdit;
  }

  // This will be set to an array of strings when copying, so that,
  // when pasting, we know what kind of selections the copied text
  // was made out of.
  var lastCopied = null;

  function applyTextInput(cm, inserted, deleted, sel, origin) {
    var doc = cm.doc;
    cm.display.shift = false;
    if (!sel) sel = doc.sel;

    var paste = cm.state.pasteIncoming || origin == "paste";
    var textLines = doc.splitLines(inserted), multiPaste = null;
    // When pasing N lines into N selections, insert one line per selection
    if (paste && sel.ranges.length > 1) {
      if (lastCopied && lastCopied.join("\n") == inserted) {
        if (sel.ranges.length % lastCopied.length == 0) {
          multiPaste = [];
          for (var i = 0; i < lastCopied.length; i++)
            multiPaste.push(doc.splitLines(lastCopied[i]));
        }
      } else if (textLines.length == sel.ranges.length) {
        multiPaste = map(textLines, function(l) { return [l]; });
      }
    }

    // Normal behavior is to insert the new text into every selection
    for (var i = sel.ranges.length - 1; i >= 0; i--) {
      var range = sel.ranges[i];
      var from = range.from(), to = range.to();
      if (range.empty()) {
        if (deleted && deleted > 0) // Handle deletion
          from = Pos(from.line, from.ch - deleted);
        else if (cm.state.overwrite && !paste) // Handle overwrite
          to = Pos(to.line, Math.min(getLine(doc, to.line).text.length, to.ch + lst(textLines).length));
      }
      var updateInput = cm.curOp.updateInput;
      var changeEvent = {from: from, to: to, text: multiPaste ? multiPaste[i % multiPaste.length] : textLines,
                         origin: origin || (paste ? "paste" : cm.state.cutIncoming ? "cut" : "+input")};
      makeChange(cm.doc, changeEvent);
      signalLater(cm, "inputRead", cm, changeEvent);
    }
    if (inserted && !paste)
      triggerElectric(cm, inserted);

    ensureCursorVisible(cm);
    cm.curOp.updateInput = updateInput;
    cm.curOp.typing = true;
    cm.state.pasteIncoming = cm.state.cutIncoming = false;
  }

  function handlePaste(e, cm) {
    var pasted = e.clipboardData && e.clipboardData.getData("text/plain");
    if (pasted) {
      e.preventDefault();
      if (!isReadOnly(cm) && !cm.options.disableInput)
        runInOp(cm, function() { applyTextInput(cm, pasted, 0, null, "paste"); });
      return true;
    }
  }

  function triggerElectric(cm, inserted) {
    // When an 'electric' character is inserted, immediately trigger a reindent
    if (!cm.options.electricChars || !cm.options.smartIndent) return;
    var sel = cm.doc.sel;

    for (var i = sel.ranges.length - 1; i >= 0; i--) {
      var range = sel.ranges[i];
      if (range.head.ch > 100 || (i && sel.ranges[i - 1].head.line == range.head.line)) continue;
      var mode = cm.getModeAt(range.head);
      var indented = false;
      if (mode.electricChars) {
        for (var j = 0; j < mode.electricChars.length; j++)
          if (inserted.indexOf(mode.electricChars.charAt(j)) > -1) {
            indented = indentLine(cm, range.head.line, "smart");
            break;
          }
      } else if (mode.electricInput) {
        if (mode.electricInput.test(getLine(cm.doc, range.head.line).text.slice(0, range.head.ch)))
          indented = indentLine(cm, range.head.line, "smart");
      }
      if (indented) signalLater(cm, "electricInput", cm, range.head.line);
    }
  }

  function copyableRanges(cm) {
    var text = [], ranges = [];
    for (var i = 0; i < cm.doc.sel.ranges.length; i++) {
      var line = cm.doc.sel.ranges[i].head.line;
      var lineRange = {anchor: Pos(line, 0), head: Pos(line + 1, 0)};
      ranges.push(lineRange);
      text.push(cm.getRange(lineRange.anchor, lineRange.head));
    }
    return {text: text, ranges: ranges};
  }

  function disableBrowserMagic(field) {
    field.setAttribute("autocorrect", "off");
    field.setAttribute("autocapitalize", "off");
    field.setAttribute("spellcheck", "false");
  }

  // TEXTAREA INPUT STYLE

  function TextareaInput(cm) {
    this.cm = cm;
    // See input.poll and input.reset
    this.prevInput = "";

    // Flag that indicates whether we expect input to appear real soon
    // now (after some event like 'keypress' or 'input') and are
    // polling intensively.
    this.pollingFast = false;
    // Self-resetting timeout for the poller
    this.polling = new Delayed();
    // Tracks when input.reset has punted to just putting a short
    // string into the textarea instead of the full selection.
    this.inaccurateSelection = false;
    // Used to work around IE issue with selection being forgotten when focus moves away from textarea
    this.hasSelection = false;
    this.composing = null;
  };

  function hiddenTextarea() {
    var te = elt("textarea", null, null, "position: absolute; padding: 0; width: 1px; height: 1em; outline: none");
    var div = elt("div", [te], null, "overflow: hidden; position: relative; width: 3px; height: 0px;");
    // The textarea is kept positioned near the cursor to prevent the
    // fact that it'll be scrolled into view on input from scrolling
    // our fake cursor out of view. On webkit, when wrap=off, paste is
    // very slow. So make the area wide instead.
    if (webkit) te.style.width = "1000px";
    else te.setAttribute("wrap", "off");
    // If border: 0; -- iOS fails to open keyboard (issue #1287)
    if (ios) te.style.border = "1px solid black";
    disableBrowserMagic(te);
    return div;
  }

  TextareaInput.prototype = copyObj({
    init: function(display) {
      var input = this, cm = this.cm;

      // Wraps and hides input textarea
      var div = this.wrapper = hiddenTextarea();
      // The semihidden textarea that is focused when the editor is
      // focused, and receives input.
      var te = this.textarea = div.firstChild;
      display.wrapper.insertBefore(div, display.wrapper.firstChild);

      // Needed to hide big blue blinking cursor on Mobile Safari (doesn't seem to work in iOS 8 anymore)
      if (ios) te.style.width = "0px";

      on(te, "input", function() {
        if (ie && ie_version >= 9 && input.hasSelection) input.hasSelection = null;
        input.poll();
      });

      on(te, "paste", function(e) {
        if (handlePaste(e, cm)) return true;

        cm.state.pasteIncoming = true;
        input.fastPoll();
      });

      function prepareCopyCut(e) {
        if (cm.somethingSelected()) {
          lastCopied = cm.getSelections();
          if (input.inaccurateSelection) {
            input.prevInput = "";
            input.inaccurateSelection = false;
            te.value = lastCopied.join("\n");
            selectInput(te);
          }
        } else if (!cm.options.lineWiseCopyCut) {
          return;
        } else {
          var ranges = copyableRanges(cm);
          lastCopied = ranges.text;
          if (e.type == "cut") {
            cm.setSelections(ranges.ranges, null, sel_dontScroll);
          } else {
            input.prevInput = "";
            te.value = ranges.text.join("\n");
            selectInput(te);
          }
        }
        if (e.type == "cut") cm.state.cutIncoming = true;
      }
      on(te, "cut", prepareCopyCut);
      on(te, "copy", prepareCopyCut);

      on(display.scroller, "paste", function(e) {
        if (eventInWidget(display, e)) return;
        cm.state.pasteIncoming = true;
        input.focus();
      });

      // Prevent normal selection in the editor (we handle our own)
      on(display.lineSpace, "selectstart", function(e) {
        if (!eventInWidget(display, e)) e_preventDefault(e);
      });

      on(te, "compositionstart", function() {
        var start = cm.getCursor("from");
        if (input.composing) input.composing.range.clear()
        input.composing = {
          start: start,
          range: cm.markText(start, cm.getCursor("to"), {className: "CodeMirror-composing"})
        };
      });
      on(te, "compositionend", function() {
        if (input.composing) {
          input.poll();
          input.composing.range.clear();
          input.composing = null;
        }
      });
    },

    prepareSelection: function() {
      // Redraw the selection and/or cursor
      var cm = this.cm, display = cm.display, doc = cm.doc;
      var result = prepareSelection(cm);

      // Move the hidden textarea near the cursor to prevent scrolling artifacts
      if (cm.options.moveInputWithCursor) {
        var headPos = cursorCoords(cm, doc.sel.primary().head, "div");
        var wrapOff = display.wrapper.getBoundingClientRect(), lineOff = display.lineDiv.getBoundingClientRect();
        result.teTop = Math.max(0, Math.min(display.wrapper.clientHeight - 10,
                                            headPos.top + lineOff.top - wrapOff.top));
        result.teLeft = Math.max(0, Math.min(display.wrapper.clientWidth - 10,
                                             headPos.left + lineOff.left - wrapOff.left));
      }

      return result;
    },

    showSelection: function(drawn) {
      var cm = this.cm, display = cm.display;
      removeChildrenAndAdd(display.cursorDiv, drawn.cursors);
      removeChildrenAndAdd(display.selectionDiv, drawn.selection);
      if (drawn.teTop != null) {
        this.wrapper.style.top = drawn.teTop + "px";
        this.wrapper.style.left = drawn.teLeft + "px";
      }
    },

    // Reset the input to correspond to the selection (or to be empty,
    // when not typing and nothing is selected)
    reset: function(typing) {
      if (this.contextMenuPending) return;
      var minimal, selected, cm = this.cm, doc = cm.doc;
      if (cm.somethingSelected()) {
        this.prevInput = "";
        var range = doc.sel.primary();
        minimal = hasCopyEvent &&
          (range.to().line - range.from().line > 100 || (selected = cm.getSelection()).length > 1000);
        var content = minimal ? "-" : selected || cm.getSelection();
        this.textarea.value = content;
        if (cm.state.focused) selectInput(this.textarea);
        if (ie && ie_version >= 9) this.hasSelection = content;
      } else if (!typing) {
        this.prevInput = this.textarea.value = "";
        if (ie && ie_version >= 9) this.hasSelection = null;
      }
      this.inaccurateSelection = minimal;
    },

    getField: function() { return this.textarea; },

    supportsTouch: function() { return false; },

    focus: function() {
      if (this.cm.options.readOnly != "nocursor" && (!mobile || activeElt() != this.textarea)) {
        try { this.textarea.focus(); }
        catch (e) {} // IE8 will throw if the textarea is display: none or not in DOM
      }
    },

    blur: function() { this.textarea.blur(); },

    resetPosition: function() {
      this.wrapper.style.top = this.wrapper.style.left = 0;
    },

    receivedFocus: function() { this.slowPoll(); },

    // Poll for input changes, using the normal rate of polling. This
    // runs as long as the editor is focused.
    slowPoll: function() {
      var input = this;
      if (input.pollingFast) return;
      input.polling.set(this.cm.options.pollInterval, function() {
        input.poll();
        if (input.cm.state.focused) input.slowPoll();
      });
    },

    // When an event has just come in that is likely to add or change
    // something in the input textarea, we poll faster, to ensure that
    // the change appears on the screen quickly.
    fastPoll: function() {
      var missed = false, input = this;
      input.pollingFast = true;
      function p() {
        var changed = input.poll();
        if (!changed && !missed) {missed = true; input.polling.set(60, p);}
        else {input.pollingFast = false; input.slowPoll();}
      }
      input.polling.set(20, p);
    },

    // Read input from the textarea, and update the document to match.
    // When something is selected, it is present in the textarea, and
    // selected (unless it is huge, in which case a placeholder is
    // used). When nothing is selected, the cursor sits after previously
    // seen text (can be empty), which is stored in prevInput (we must
    // not reset the textarea when typing, because that breaks IME).
    poll: function() {
      var cm = this.cm, input = this.textarea, prevInput = this.prevInput;
      // Since this is called a *lot*, try to bail out as cheaply as
      // possible when it is clear that nothing happened. hasSelection
      // will be the case when there is a lot of text in the textarea,
      // in which case reading its value would be expensive.
      if (this.contextMenuPending || !cm.state.focused ||
          (hasSelection(input) && !prevInput && !this.composing) ||
          isReadOnly(cm) || cm.options.disableInput || cm.state.keySeq)
        return false;

      var text = input.value;
      // If nothing changed, bail.
      if (text == prevInput && !cm.somethingSelected()) return false;
      // Work around nonsensical selection resetting in IE9/10, and
      // inexplicable appearance of private area unicode characters on
      // some key combos in Mac (#2689).
      if (ie && ie_version >= 9 && this.hasSelection === text ||
          mac && /[\uf700-\uf7ff]/.test(text)) {
        cm.display.input.reset();
        return false;
      }

      if (cm.doc.sel == cm.display.selForContextMenu) {
        var first = text.charCodeAt(0);
        if (first == 0x200b && !prevInput) prevInput = "\u200b";
        if (first == 0x21da) { this.reset(); return this.cm.execCommand("undo"); }
      }
      // Find the part of the input that is actually new
      var same = 0, l = Math.min(prevInput.length, text.length);
      while (same < l && prevInput.charCodeAt(same) == text.charCodeAt(same)) ++same;

      var self = this;
      runInOp(cm, function() {
        applyTextInput(cm, text.slice(same), prevInput.length - same,
                       null, self.composing ? "*compose" : null);

        // Don't leave long text in the textarea, since it makes further polling slow
        if (text.length > 1000 || text.indexOf("\n") > -1) input.value = self.prevInput = "";
        else self.prevInput = text;

        if (self.composing) {
          self.composing.range.clear();
          self.composing.range = cm.markText(self.composing.start, cm.getCursor("to"),
                                             {className: "CodeMirror-composing"});
        }
      });
      return true;
    },

    ensurePolled: function() {
      if (this.pollingFast && this.poll()) this.pollingFast = false;
    },

    onKeyPress: function() {
      if (ie && ie_version >= 9) this.hasSelection = null;
      this.fastPoll();
    },

    onContextMenu: function(e) {
      var input = this, cm = input.cm, display = cm.display, te = input.textarea;
      var pos = posFromMouse(cm, e), scrollPos = display.scroller.scrollTop;
      if (!pos || presto) return; // Opera is difficult.

      // Reset the current text selection only if the click is done outside of the selection
      // and 'resetSelectionOnContextMenu' option is true.
      var reset = cm.options.resetSelectionOnContextMenu;
      if (reset && cm.doc.sel.contains(pos) == -1)
        operation(cm, setSelection)(cm.doc, simpleSelection(pos), sel_dontScroll);

      var oldCSS = te.style.cssText;
      input.wrapper.style.position = "absolute";
      te.style.cssText = "position: fixed; width: 30px; height: 30px; top: " + (e.clientY - 5) +
        "px; left: " + (e.clientX - 5) + "px; z-index: 1000; background: " +
        (ie ? "rgba(255, 255, 255, .05)" : "transparent") +
        "; outline: none; border-width: 0; outline: none; overflow: hidden; opacity: .05; filter: alpha(opacity=5);";
      if (webkit) var oldScrollY = window.scrollY; // Work around Chrome issue (#2712)
      display.input.focus();
      if (webkit) window.scrollTo(null, oldScrollY);
      display.input.reset();
      // Adds "Select all" to context menu in FF
      if (!cm.somethingSelected()) te.value = input.prevInput = " ";
      input.contextMenuPending = true;
      display.selForContextMenu = cm.doc.sel;
      clearTimeout(display.detectingSelectAll);

      // Select-all will be greyed out if there's nothing to select, so
      // this adds a zero-width space so that we can later check whether
      // it got selected.
      function prepareSelectAllHack() {
        if (te.selectionStart != null) {
          var selected = cm.somethingSelected();
          var extval = "\u200b" + (selected ? te.value : "");
          te.value = "\u21da"; // Used to catch context-menu undo
          te.value = extval;
          input.prevInput = selected ? "" : "\u200b";
          te.selectionStart = 1; te.selectionEnd = extval.length;
          // Re-set this, in case some other handler touched the
          // selection in the meantime.
          display.selForContextMenu = cm.doc.sel;
        }
      }
      function rehide() {
        input.contextMenuPending = false;
        input.wrapper.style.position = "relative";
        te.style.cssText = oldCSS;
        if (ie && ie_version < 9) display.scrollbars.setScrollTop(display.scroller.scrollTop = scrollPos);

        // Try to detect the user choosing select-all
        if (te.selectionStart != null) {
          if (!ie || (ie && ie_version < 9)) prepareSelectAllHack();
          var i = 0, poll = function() {
            if (display.selForContextMenu == cm.doc.sel && te.selectionStart == 0 &&
                te.selectionEnd > 0 && input.prevInput == "\u200b")
              operation(cm, commands.selectAll)(cm);
            else if (i++ < 10) display.detectingSelectAll = setTimeout(poll, 500);
            else display.input.reset();
          };
          display.detectingSelectAll = setTimeout(poll, 200);
        }
      }

      if (ie && ie_version >= 9) prepareSelectAllHack();
      if (captureRightClick) {
        e_stop(e);
        var mouseup = function() {
          off(window, "mouseup", mouseup);
          setTimeout(rehide, 20);
        };
        on(window, "mouseup", mouseup);
      } else {
        setTimeout(rehide, 50);
      }
    },

    readOnlyChanged: function(val) {
      if (!val) this.reset();
    },

    setUneditable: nothing,

    needsContentAttribute: false
  }, TextareaInput.prototype);

  // CONTENTEDITABLE INPUT STYLE

  function ContentEditableInput(cm) {
    this.cm = cm;
    this.lastAnchorNode = this.lastAnchorOffset = this.lastFocusNode = this.lastFocusOffset = null;
    this.polling = new Delayed();
    this.gracePeriod = false;
  }

  ContentEditableInput.prototype = copyObj({
    init: function(display) {
      var input = this, cm = input.cm;
      var div = input.div = display.lineDiv;
      disableBrowserMagic(div);

      on(div, "paste", function(e) { handlePaste(e, cm); })

      on(div, "compositionstart", function(e) {
        var data = e.data;
        input.composing = {sel: cm.doc.sel, data: data, startData: data};
        if (!data) return;
        var prim = cm.doc.sel.primary();
        var line = cm.getLine(prim.head.line);
        var found = line.indexOf(data, Math.max(0, prim.head.ch - data.length));
        if (found > -1 && found <= prim.head.ch)
          input.composing.sel = simpleSelection(Pos(prim.head.line, found),
                                                Pos(prim.head.line, found + data.length));
      });
      on(div, "compositionupdate", function(e) {
        input.composing.data = e.data;
      });
      on(div, "compositionend", function(e) {
        var ours = input.composing;
        if (!ours) return;
        if (e.data != ours.startData && !/\u200b/.test(e.data))
          ours.data = e.data;
        // Need a small delay to prevent other code (input event,
        // selection polling) from doing damage when fired right after
        // compositionend.
        setTimeout(function() {
          if (!ours.handled)
            input.applyComposition(ours);
          if (input.composing == ours)
            input.composing = null;
        }, 50);
      });

      on(div, "touchstart", function() {
        input.forceCompositionEnd();
      });

      on(div, "input", function() {
        if (input.composing) return;
        if (isReadOnly(cm) || !input.pollContent())
          runInOp(input.cm, function() {regChange(cm);});
      });

      function onCopyCut(e) {
        if (cm.somethingSelected()) {
          lastCopied = cm.getSelections();
          if (e.type == "cut") cm.replaceSelection("", null, "cut");
        } else if (!cm.options.lineWiseCopyCut) {
          return;
        } else {
          var ranges = copyableRanges(cm);
          lastCopied = ranges.text;
          if (e.type == "cut") {
            cm.operation(function() {
              cm.setSelections(ranges.ranges, 0, sel_dontScroll);
              cm.replaceSelection("", null, "cut");
            });
          }
        }
        // iOS exposes the clipboard API, but seems to discard content inserted into it
        if (e.clipboardData && !ios) {
          e.preventDefault();
          e.clipboardData.clearData();
          e.clipboardData.setData("text/plain", lastCopied.join("\n"));
        } else {
          // Old-fashioned briefly-focus-a-textarea hack
          var kludge = hiddenTextarea(), te = kludge.firstChild;
          cm.display.lineSpace.insertBefore(kludge, cm.display.lineSpace.firstChild);
          te.value = lastCopied.join("\n");
          var hadFocus = document.activeElement;
          selectInput(te);
          setTimeout(function() {
            cm.display.lineSpace.removeChild(kludge);
            hadFocus.focus();
          }, 50);
        }
      }
      on(div, "copy", onCopyCut);
      on(div, "cut", onCopyCut);
    },

    prepareSelection: function() {
      var result = prepareSelection(this.cm, false);
      result.focus = this.cm.state.focused;
      return result;
    },

    showSelection: function(info) {
      if (!info || !this.cm.display.view.length) return;
      if (info.focus) this.showPrimarySelection();
      this.showMultipleSelections(info);
    },

    showPrimarySelection: function() {
      var sel = window.getSelection(), prim = this.cm.doc.sel.primary();
      var curAnchor = domToPos(this.cm, sel.anchorNode, sel.anchorOffset);
      var curFocus = domToPos(this.cm, sel.focusNode, sel.focusOffset);
      if (curAnchor && !curAnchor.bad && curFocus && !curFocus.bad &&
          cmp(minPos(curAnchor, curFocus), prim.from()) == 0 &&
          cmp(maxPos(curAnchor, curFocus), prim.to()) == 0)
        return;

      var start = posToDOM(this.cm, prim.from());
      var end = posToDOM(this.cm, prim.to());
      if (!start && !end) return;

      var view = this.cm.display.view;
      var old = sel.rangeCount && sel.getRangeAt(0);
      if (!start) {
        start = {node: view[0].measure.map[2], offset: 0};
      } else if (!end) { // FIXME dangerously hacky
        var measure = view[view.length - 1].measure;
        var map = measure.maps ? measure.maps[measure.maps.length - 1] : measure.map;
        end = {node: map[map.length - 1], offset: map[map.length - 2] - map[map.length - 3]};
      }

      try { var rng = range(start.node, start.offset, end.offset, end.node); }
      catch(e) {} // Our model of the DOM might be outdated, in which case the range we try to set can be impossible
      if (rng) {
        sel.removeAllRanges();
        sel.addRange(rng);
        if (old && sel.anchorNode == null) sel.addRange(old);
        else if (gecko) this.startGracePeriod();
      }
      this.rememberSelection();
    },

    startGracePeriod: function() {
      var input = this;
      clearTimeout(this.gracePeriod);
      this.gracePeriod = setTimeout(function() {
        input.gracePeriod = false;
        if (input.selectionChanged())
          input.cm.operation(function() { input.cm.curOp.selectionChanged = true; });
      }, 20);
    },

    showMultipleSelections: function(info) {
      removeChildrenAndAdd(this.cm.display.cursorDiv, info.cursors);
      removeChildrenAndAdd(this.cm.display.selectionDiv, info.selection);
    },

    rememberSelection: function() {
      var sel = window.getSelection();
      this.lastAnchorNode = sel.anchorNode; this.lastAnchorOffset = sel.anchorOffset;
      this.lastFocusNode = sel.focusNode; this.lastFocusOffset = sel.focusOffset;
    },

    selectionInEditor: function() {
      var sel = window.getSelection();
      if (!sel.rangeCount) return false;
      var node = sel.getRangeAt(0).commonAncestorContainer;
      return contains(this.div, node);
    },

    focus: function() {
      if (this.cm.options.readOnly != "nocursor") this.div.focus();
    },
    blur: function() { this.div.blur(); },
    getField: function() { return this.div; },

    supportsTouch: function() { return true; },

    receivedFocus: function() {
      var input = this;
      if (this.selectionInEditor())
        this.pollSelection();
      else
        runInOp(this.cm, function() { input.cm.curOp.selectionChanged = true; });

      function poll() {
        if (input.cm.state.focused) {
          input.pollSelection();
          input.polling.set(input.cm.options.pollInterval, poll);
        }
      }
      this.polling.set(this.cm.options.pollInterval, poll);
    },

    selectionChanged: function() {
      var sel = window.getSelection();
      return sel.anchorNode != this.lastAnchorNode || sel.anchorOffset != this.lastAnchorOffset ||
        sel.focusNode != this.lastFocusNode || sel.focusOffset != this.lastFocusOffset;
    },

    pollSelection: function() {
      if (!this.composing && !this.gracePeriod && this.selectionChanged()) {
        var sel = window.getSelection(), cm = this.cm;
        this.rememberSelection();
        var anchor = domToPos(cm, sel.anchorNode, sel.anchorOffset);
        var head = domToPos(cm, sel.focusNode, sel.focusOffset);
        if (anchor && head) runInOp(cm, function() {
          setSelection(cm.doc, simpleSelection(anchor, head), sel_dontScroll);
          if (anchor.bad || head.bad) cm.curOp.selectionChanged = true;
        });
      }
    },

    pollContent: function() {
      var cm = this.cm, display = cm.display, sel = cm.doc.sel.primary();
      var from = sel.from(), to = sel.to();
      if (from.line < display.viewFrom || to.line > display.viewTo - 1) return false;

      var fromIndex;
      if (from.line == display.viewFrom || (fromIndex = findViewIndex(cm, from.line)) == 0) {
        var fromLine = lineNo(display.view[0].line);
        var fromNode = display.view[0].node;
      } else {
        var fromLine = lineNo(display.view[fromIndex].line);
        var fromNode = display.view[fromIndex - 1].node.nextSibling;
      }
      var toIndex = findViewIndex(cm, to.line);
      if (toIndex == display.view.length - 1) {
        var toLine = display.viewTo - 1;
        var toNode = display.lineDiv.lastChild;
      } else {
        var toLine = lineNo(display.view[toIndex + 1].line) - 1;
        var toNode = display.view[toIndex + 1].node.previousSibling;
      }

      var newText = cm.doc.splitLines(domTextBetween(cm, fromNode, toNode, fromLine, toLine));
      var oldText = getBetween(cm.doc, Pos(fromLine, 0), Pos(toLine, getLine(cm.doc, toLine).text.length));
      while (newText.length > 1 && oldText.length > 1) {
        if (lst(newText) == lst(oldText)) { newText.pop(); oldText.pop(); toLine--; }
        else if (newText[0] == oldText[0]) { newText.shift(); oldText.shift(); fromLine++; }
        else break;
      }

      var cutFront = 0, cutEnd = 0;
      var newTop = newText[0], oldTop = oldText[0], maxCutFront = Math.min(newTop.length, oldTop.length);
      while (cutFront < maxCutFront && newTop.charCodeAt(cutFront) == oldTop.charCodeAt(cutFront))
        ++cutFront;
      var newBot = lst(newText), oldBot = lst(oldText);
      var maxCutEnd = Math.min(newBot.length - (newText.length == 1 ? cutFront : 0),
                               oldBot.length - (oldText.length == 1 ? cutFront : 0));
      while (cutEnd < maxCutEnd &&
             newBot.charCodeAt(newBot.length - cutEnd - 1) == oldBot.charCodeAt(oldBot.length - cutEnd - 1))
        ++cutEnd;

      newText[newText.length - 1] = newBot.slice(0, newBot.length - cutEnd);
      newText[0] = newText[0].slice(cutFront);

      var chFrom = Pos(fromLine, cutFront);
      var chTo = Pos(toLine, oldText.length ? lst(oldText).length - cutEnd : 0);
      if (newText.length > 1 || newText[0] || cmp(chFrom, chTo)) {
        replaceRange(cm.doc, newText, chFrom, chTo, "+input");
        return true;
      }
    },

    ensurePolled: function() {
      this.forceCompositionEnd();
    },
    reset: function() {
      this.forceCompositionEnd();
    },
    forceCompositionEnd: function() {
      if (!this.composing || this.composing.handled) return;
      this.applyComposition(this.composing);
      this.composing.handled = true;
      this.div.blur();
      this.div.focus();
    },
    applyComposition: function(composing) {
      if (isReadOnly(this.cm))
        operation(this.cm, regChange)(this.cm)
      else if (composing.data && composing.data != composing.startData)
        operation(this.cm, applyTextInput)(this.cm, composing.data, 0, composing.sel);
    },

    setUneditable: function(node) {
      node.contentEditable = "false"
    },

    onKeyPress: function(e) {
      e.preventDefault();
      if (!isReadOnly(this.cm))
        operation(this.cm, applyTextInput)(this.cm, String.fromCharCode(e.charCode == null ? e.keyCode : e.charCode), 0);
    },

    readOnlyChanged: function(val) {
      this.div.contentEditable = String(val != "nocursor")
    },

    onContextMenu: nothing,
    resetPosition: nothing,

    needsContentAttribute: true
  }, ContentEditableInput.prototype);

  function posToDOM(cm, pos) {
    var view = findViewForLine(cm, pos.line);
    if (!view || view.hidden) return null;
    var line = getLine(cm.doc, pos.line);
    var info = mapFromLineView(view, line, pos.line);

    var order = getOrder(line), side = "left";
    if (order) {
      var partPos = getBidiPartAt(order, pos.ch);
      side = partPos % 2 ? "right" : "left";
    }
    var result = nodeAndOffsetInLineMap(info.map, pos.ch, side);
    result.offset = result.collapse == "right" ? result.end : result.start;
    return result;
  }

  function badPos(pos, bad) { if (bad) pos.bad = true; return pos; }

  function domToPos(cm, node, offset) {
    var lineNode;
    if (node == cm.display.lineDiv) {
      lineNode = cm.display.lineDiv.childNodes[offset];
      if (!lineNode) return badPos(cm.clipPos(Pos(cm.display.viewTo - 1)), true);
      node = null; offset = 0;
    } else {
      for (lineNode = node;; lineNode = lineNode.parentNode) {
        if (!lineNode || lineNode == cm.display.lineDiv) return null;
        if (lineNode.parentNode && lineNode.parentNode == cm.display.lineDiv) break;
      }
    }
    for (var i = 0; i < cm.display.view.length; i++) {
      var lineView = cm.display.view[i];
      if (lineView.node == lineNode)
        return locateNodeInLineView(lineView, node, offset);
    }
  }

  function locateNodeInLineView(lineView, node, offset) {
    var wrapper = lineView.text.firstChild, bad = false;
    if (!node || !contains(wrapper, node)) return badPos(Pos(lineNo(lineView.line), 0), true);
    if (node == wrapper) {
      bad = true;
      node = wrapper.childNodes[offset];
      offset = 0;
      if (!node) {
        var line = lineView.rest ? lst(lineView.rest) : lineView.line;
        return badPos(Pos(lineNo(line), line.text.length), bad);
      }
    }

    var textNode = node.nodeType == 3 ? node : null, topNode = node;
    if (!textNode && node.childNodes.length == 1 && node.firstChild.nodeType == 3) {
      textNode = node.firstChild;
      if (offset) offset = textNode.nodeValue.length;
    }
    while (topNode.parentNode != wrapper) topNode = topNode.parentNode;
    var measure = lineView.measure, maps = measure.maps;

    function find(textNode, topNode, offset) {
      for (var i = -1; i < (maps ? maps.length : 0); i++) {
        var map = i < 0 ? measure.map : maps[i];
        for (var j = 0; j < map.length; j += 3) {
          var curNode = map[j + 2];
          if (curNode == textNode || curNode == topNode) {
            var line = lineNo(i < 0 ? lineView.line : lineView.rest[i]);
            var ch = map[j] + offset;
            if (offset < 0 || curNode != textNode) ch = map[j + (offset ? 1 : 0)];
            return Pos(line, ch);
          }
        }
      }
    }
    var found = find(textNode, topNode, offset);
    if (found) return badPos(found, bad);

    // FIXME this is all really shaky. might handle the few cases it needs to handle, but likely to cause problems
    for (var after = topNode.nextSibling, dist = textNode ? textNode.nodeValue.length - offset : 0; after; after = after.nextSibling) {
      found = find(after, after.firstChild, 0);
      if (found)
        return badPos(Pos(found.line, found.ch - dist), bad);
      else
        dist += after.textContent.length;
    }
    for (var before = topNode.previousSibling, dist = offset; before; before = before.previousSibling) {
      found = find(before, before.firstChild, -1);
      if (found)
        return badPos(Pos(found.line, found.ch + dist), bad);
      else
        dist += after.textContent.length;
    }
  }

  function domTextBetween(cm, from, to, fromLine, toLine) {
    var text = "", closing = false, lineSep = cm.doc.lineSeparator();
    function recognizeMarker(id) { return function(marker) { return marker.id == id; }; }
    function walk(node) {
      if (node.nodeType == 1) {
        var cmText = node.getAttribute("cm-text");
        if (cmText != null) {
          if (cmText == "") cmText = node.textContent.replace(/\u200b/g, "");
          text += cmText;
          return;
        }
        var markerID = node.getAttribute("cm-marker"), range;
        if (markerID) {
          var found = cm.findMarks(Pos(fromLine, 0), Pos(toLine + 1, 0), recognizeMarker(+markerID));
          if (found.length && (range = found[0].find()))
            text += getBetween(cm.doc, range.from, range.to).join(lineSep);
          return;
        }
        if (node.getAttribute("contenteditable") == "false") return;
        for (var i = 0; i < node.childNodes.length; i++)
          walk(node.childNodes[i]);
        if (/^(pre|div|p)$/i.test(node.nodeName))
          closing = true;
      } else if (node.nodeType == 3) {
        var val = node.nodeValue;
        if (!val) return;
        if (closing) {
          text += lineSep;
          closing = false;
        }
        text += val;
      }
    }
    for (;;) {
      walk(from);
      if (from == to) break;
      from = from.nextSibling;
    }
    return text;
  }

  CodeMirror.inputStyles = {"textarea": TextareaInput, "contenteditable": ContentEditableInput};

  // SELECTION / CURSOR

  // Selection objects are immutable. A new one is created every time
  // the selection changes. A selection is one or more non-overlapping
  // (and non-touching) ranges, sorted, and an integer that indicates
  // which one is the primary selection (the one that's scrolled into
  // view, that getCursor returns, etc).
  function Selection(ranges, primIndex) {
    this.ranges = ranges;
    this.primIndex = primIndex;
  }

  Selection.prototype = {
    primary: function() { return this.ranges[this.primIndex]; },
    equals: function(other) {
      if (other == this) return true;
      if (other.primIndex != this.primIndex || other.ranges.length != this.ranges.length) return false;
      for (var i = 0; i < this.ranges.length; i++) {
        var here = this.ranges[i], there = other.ranges[i];
        if (cmp(here.anchor, there.anchor) != 0 || cmp(here.head, there.head) != 0) return false;
      }
      return true;
    },
    deepCopy: function() {
      for (var out = [], i = 0; i < this.ranges.length; i++)
        out[i] = new Range(copyPos(this.ranges[i].anchor), copyPos(this.ranges[i].head));
      return new Selection(out, this.primIndex);
    },
    somethingSelected: function() {
      for (var i = 0; i < this.ranges.length; i++)
        if (!this.ranges[i].empty()) return true;
      return false;
    },
    contains: function(pos, end) {
      if (!end) end = pos;
      for (var i = 0; i < this.ranges.length; i++) {
        var range = this.ranges[i];
        if (cmp(end, range.from()) >= 0 && cmp(pos, range.to()) <= 0)
          return i;
      }
      return -1;
    }
  };

  function Range(anchor, head) {
    this.anchor = anchor; this.head = head;
  }

  Range.prototype = {
    from: function() { return minPos(this.anchor, this.head); },
    to: function() { return maxPos(this.anchor, this.head); },
    empty: function() {
      return this.head.line == this.anchor.line && this.head.ch == this.anchor.ch;
    }
  };

  // Take an unsorted, potentially overlapping set of ranges, and
  // build a selection out of it. 'Consumes' ranges array (modifying
  // it).
  function normalizeSelection(ranges, primIndex) {
    var prim = ranges[primIndex];
    ranges.sort(function(a, b) { return cmp(a.from(), b.from()); });
    primIndex = indexOf(ranges, prim);
    for (var i = 1; i < ranges.length; i++) {
      var cur = ranges[i], prev = ranges[i - 1];
      if (cmp(prev.to(), cur.from()) >= 0) {
        var from = minPos(prev.from(), cur.from()), to = maxPos(prev.to(), cur.to());
        var inv = prev.empty() ? cur.from() == cur.head : prev.from() == prev.head;
        if (i <= primIndex) --primIndex;
        ranges.splice(--i, 2, new Range(inv ? to : from, inv ? from : to));
      }
    }
    return new Selection(ranges, primIndex);
  }

  function simpleSelection(anchor, head) {
    return new Selection([new Range(anchor, head || anchor)], 0);
  }

  // Most of the external API clips given positions to make sure they
  // actually exist within the document.
  function clipLine(doc, n) {return Math.max(doc.first, Math.min(n, doc.first + doc.size - 1));}
  function clipPos(doc, pos) {
    if (pos.line < doc.first) return Pos(doc.first, 0);
    var last = doc.first + doc.size - 1;
    if (pos.line > last) return Pos(last, getLine(doc, last).text.length);
    return clipToLen(pos, getLine(doc, pos.line).text.length);
  }
  function clipToLen(pos, linelen) {
    var ch = pos.ch;
    if (ch == null || ch > linelen) return Pos(pos.line, linelen);
    else if (ch < 0) return Pos(pos.line, 0);
    else return pos;
  }
  function isLine(doc, l) {return l >= doc.first && l < doc.first + doc.size;}
  function clipPosArray(doc, array) {
    for (var out = [], i = 0; i < array.length; i++) out[i] = clipPos(doc, array[i]);
    return out;
  }

  // SELECTION UPDATES

  // The 'scroll' parameter given to many of these indicated whether
  // the new cursor position should be scrolled into view after
  // modifying the selection.

  // If shift is held or the extend flag is set, extends a range to
  // include a given position (and optionally a second position).
  // Otherwise, simply returns the range between the given positions.
  // Used for cursor motion and such.
  function extendRange(doc, range, head, other) {
    if (doc.cm && doc.cm.display.shift || doc.extend) {
      var anchor = range.anchor;
      if (other) {
        var posBefore = cmp(head, anchor) < 0;
        if (posBefore != (cmp(other, anchor) < 0)) {
          anchor = head;
          head = other;
        } else if (posBefore != (cmp(head, other) < 0)) {
          head = other;
        }
      }
      return new Range(anchor, head);
    } else {
      return new Range(other || head, head);
    }
  }

  // Extend the primary selection range, discard the rest.
  function extendSelection(doc, head, other, options) {
    setSelection(doc, new Selection([extendRange(doc, doc.sel.primary(), head, other)], 0), options);
  }

  // Extend all selections (pos is an array of selections with length
  // equal the number of selections)
  function extendSelections(doc, heads, options) {
    for (var out = [], i = 0; i < doc.sel.ranges.length; i++)
      out[i] = extendRange(doc, doc.sel.ranges[i], heads[i], null);
    var newSel = normalizeSelection(out, doc.sel.primIndex);
    setSelection(doc, newSel, options);
  }

  // Updates a single range in the selection.
  function replaceOneSelection(doc, i, range, options) {
    var ranges = doc.sel.ranges.slice(0);
    ranges[i] = range;
    setSelection(doc, normalizeSelection(ranges, doc.sel.primIndex), options);
  }

  // Reset the selection to a single range.
  function setSimpleSelection(doc, anchor, head, options) {
    setSelection(doc, simpleSelection(anchor, head), options);
  }

  // Give beforeSelectionChange handlers a change to influence a
  // selection update.
  function filterSelectionChange(doc, sel) {
    var obj = {
      ranges: sel.ranges,
      update: function(ranges) {
        this.ranges = [];
        for (var i = 0; i < ranges.length; i++)
          this.ranges[i] = new Range(clipPos(doc, ranges[i].anchor),
                                     clipPos(doc, ranges[i].head));
      }
    };
    signal(doc, "beforeSelectionChange", doc, obj);
    if (doc.cm) signal(doc.cm, "beforeSelectionChange", doc.cm, obj);
    if (obj.ranges != sel.ranges) return normalizeSelection(obj.ranges, obj.ranges.length - 1);
    else return sel;
  }

  function setSelectionReplaceHistory(doc, sel, options) {
    var done = doc.history.done, last = lst(done);
    if (last && last.ranges) {
      done[done.length - 1] = sel;
      setSelectionNoUndo(doc, sel, options);
    } else {
      setSelection(doc, sel, options);
    }
  }

  // Set a new selection.
  function setSelection(doc, sel, options) {
    setSelectionNoUndo(doc, sel, options);
    addSelectionToHistory(doc, doc.sel, doc.cm ? doc.cm.curOp.id : NaN, options);
  }

  function setSelectionNoUndo(doc, sel, options) {
    if (hasHandler(doc, "beforeSelectionChange") || doc.cm && hasHandler(doc.cm, "beforeSelectionChange"))
      sel = filterSelectionChange(doc, sel);

    var bias = options && options.bias ||
      (cmp(sel.primary().head, doc.sel.primary().head) < 0 ? -1 : 1);
    setSelectionInner(doc, skipAtomicInSelection(doc, sel, bias, true));

    if (!(options && options.scroll === false) && doc.cm)
      ensureCursorVisible(doc.cm);
  }

  function setSelectionInner(doc, sel) {
    if (sel.equals(doc.sel)) return;

    doc.sel = sel;

    if (doc.cm) {
      doc.cm.curOp.updateInput = doc.cm.curOp.selectionChanged = true;
      signalCursorActivity(doc.cm);
    }
    signalLater(doc, "cursorActivity", doc);
  }

  // Verify that the selection does not partially select any atomic
  // marked ranges.
  function reCheckSelection(doc) {
    setSelectionInner(doc, skipAtomicInSelection(doc, doc.sel, null, false), sel_dontScroll);
  }

  // Return a selection that does not partially select any atomic
  // ranges.
  function skipAtomicInSelection(doc, sel, bias, mayClear) {
    var out;
    for (var i = 0; i < sel.ranges.length; i++) {
      var range = sel.ranges[i];
      var newAnchor = skipAtomic(doc, range.anchor, bias, mayClear);
      var newHead = skipAtomic(doc, range.head, bias, mayClear);
      if (out || newAnchor != range.anchor || newHead != range.head) {
        if (!out) out = sel.ranges.slice(0, i);
        out[i] = new Range(newAnchor, newHead);
      }
    }
    return out ? normalizeSelection(out, sel.primIndex) : sel;
  }

  // Ensure a given position is not inside an atomic range.
  function skipAtomic(doc, pos, bias, mayClear) {
    var flipped = false, curPos = pos;
    var dir = bias || 1;
    doc.cantEdit = false;
    search: for (;;) {
      var line = getLine(doc, curPos.line);
      if (line.markedSpans) {
        for (var i = 0; i < line.markedSpans.length; ++i) {
          var sp = line.markedSpans[i], m = sp.marker;
          if ((sp.from == null || (m.inclusiveLeft ? sp.from <= curPos.ch : sp.from < curPos.ch)) &&
              (sp.to == null || (m.inclusiveRight ? sp.to >= curPos.ch : sp.to > curPos.ch))) {
            if (mayClear) {
              signal(m, "beforeCursorEnter");
              if (m.explicitlyCleared) {
                if (!line.markedSpans) break;
                else {--i; continue;}
              }
            }
            if (!m.atomic) continue;
            var newPos = m.find(dir < 0 ? -1 : 1);
            if (cmp(newPos, curPos) == 0) {
              newPos.ch += dir;
              if (newPos.ch < 0) {
                if (newPos.line > doc.first) newPos = clipPos(doc, Pos(newPos.line - 1));
                else newPos = null;
              } else if (newPos.ch > line.text.length) {
                if (newPos.line < doc.first + doc.size - 1) newPos = Pos(newPos.line + 1, 0);
                else newPos = null;
              }
              if (!newPos) {
                if (flipped) {
                  // Driven in a corner -- no valid cursor position found at all
                  // -- try again *with* clearing, if we didn't already
                  if (!mayClear) return skipAtomic(doc, pos, bias, true);
                  // Otherwise, turn off editing until further notice, and return the start of the doc
                  doc.cantEdit = true;
                  return Pos(doc.first, 0);
                }
                flipped = true; newPos = pos; dir = -dir;
              }
            }
            curPos = newPos;
            continue search;
          }
        }
      }
      return curPos;
    }
  }

  // SELECTION DRAWING

  function updateSelection(cm) {
    cm.display.input.showSelection(cm.display.input.prepareSelection());
  }

  function prepareSelection(cm, primary) {
    var doc = cm.doc, result = {};
    var curFragment = result.cursors = document.createDocumentFragment();
    var selFragment = result.selection = document.createDocumentFragment();

    for (var i = 0; i < doc.sel.ranges.length; i++) {
      if (primary === false && i == doc.sel.primIndex) continue;
      var range = doc.sel.ranges[i];
      var collapsed = range.empty();
      if (collapsed || cm.options.showCursorWhenSelecting)
        drawSelectionCursor(cm, range.head, curFragment);
      if (!collapsed)
        drawSelectionRange(cm, range, selFragment);
    }
    return result;
  }

  // Draws a cursor for the given range
  function drawSelectionCursor(cm, head, output) {
    var pos = cursorCoords(cm, head, "div", null, null, !cm.options.singleCursorHeightPerLine);

    var cursor = output.appendChild(elt("div", "\u00a0", "CodeMirror-cursor"));
    cursor.style.left = pos.left + "px";
    cursor.style.top = pos.top + "px";
    cursor.style.height = Math.max(0, pos.bottom - pos.top) * cm.options.cursorHeight + "px";

    if (pos.other) {
      // Secondary cursor, shown when on a 'jump' in bi-directional text
      var otherCursor = output.appendChild(elt("div", "\u00a0", "CodeMirror-cursor CodeMirror-secondarycursor"));
      otherCursor.style.display = "";
      otherCursor.style.left = pos.other.left + "px";
      otherCursor.style.top = pos.other.top + "px";
      otherCursor.style.height = (pos.other.bottom - pos.other.top) * .85 + "px";
    }
  }

  // Draws the given range as a highlighted selection
  function drawSelectionRange(cm, range, output) {
    var display = cm.display, doc = cm.doc;
    var fragment = document.createDocumentFragment();
    var padding = paddingH(cm.display), leftSide = padding.left;
    var rightSide = Math.max(display.sizerWidth, displayWidth(cm) - display.sizer.offsetLeft) - padding.right;

    function add(left, top, width, bottom) {
      if (top < 0) top = 0;
      top = Math.round(top);
      bottom = Math.round(bottom);
      fragment.appendChild(elt("div", null, "CodeMirror-selected", "position: absolute; left: " + left +
                               "px; top: " + top + "px; width: " + (width == null ? rightSide - left : width) +
                               "px; height: " + (bottom - top) + "px"));
    }

    function drawForLine(line, fromArg, toArg) {
      var lineObj = getLine(doc, line);
      var lineLen = lineObj.text.length;
      var start, end;
      function coords(ch, bias) {
        return charCoords(cm, Pos(line, ch), "div", lineObj, bias);
      }

      iterateBidiSections(getOrder(lineObj), fromArg || 0, toArg == null ? lineLen : toArg, function(from, to, dir) {
        var leftPos = coords(from, "left"), rightPos, left, right;
        if (from == to) {
          rightPos = leftPos;
          left = right = leftPos.left;
        } else {
          rightPos = coords(to - 1, "right");
          if (dir == "rtl") { var tmp = leftPos; leftPos = rightPos; rightPos = tmp; }
          left = leftPos.left;
          right = rightPos.right;
        }
        if (fromArg == null && from == 0) left = leftSide;
        if (rightPos.top - leftPos.top > 3) { // Different lines, draw top part
          add(left, leftPos.top, null, leftPos.bottom);
          left = leftSide;
          if (leftPos.bottom < rightPos.top) add(left, leftPos.bottom, null, rightPos.top);
        }
        if (toArg == null && to == lineLen) right = rightSide;
        if (!start || leftPos.top < start.top || leftPos.top == start.top && leftPos.left < start.left)
          start = leftPos;
        if (!end || rightPos.bottom > end.bottom || rightPos.bottom == end.bottom && rightPos.right > end.right)
          end = rightPos;
        if (left < leftSide + 1) left = leftSide;
        add(left, rightPos.top, right - left, rightPos.bottom);
      });
      return {start: start, end: end};
    }

    var sFrom = range.from(), sTo = range.to();
    if (sFrom.line == sTo.line) {
      drawForLine(sFrom.line, sFrom.ch, sTo.ch);
    } else {
      var fromLine = getLine(doc, sFrom.line), toLine = getLine(doc, sTo.line);
      var singleVLine = visualLine(fromLine) == visualLine(toLine);
      var leftEnd = drawForLine(sFrom.line, sFrom.ch, singleVLine ? fromLine.text.length + 1 : null).end;
      var rightStart = drawForLine(sTo.line, singleVLine ? 0 : null, sTo.ch).start;
      if (singleVLine) {
        if (leftEnd.top < rightStart.top - 2) {
          add(leftEnd.right, leftEnd.top, null, leftEnd.bottom);
          add(leftSide, rightStart.top, rightStart.left, rightStart.bottom);
        } else {
          add(leftEnd.right, leftEnd.top, rightStart.left - leftEnd.right, leftEnd.bottom);
        }
      }
      if (leftEnd.bottom < rightStart.top)
        add(leftSide, leftEnd.bottom, null, rightStart.top);
    }

    output.appendChild(fragment);
  }

  // Cursor-blinking
  function restartBlink(cm) {
    if (!cm.state.focused) return;
    var display = cm.display;
    clearInterval(display.blinker);
    var on = true;
    display.cursorDiv.style.visibility = "";
    if (cm.options.cursorBlinkRate > 0)
      display.blinker = setInterval(function() {
        display.cursorDiv.style.visibility = (on = !on) ? "" : "hidden";
      }, cm.options.cursorBlinkRate);
    else if (cm.options.cursorBlinkRate < 0)
      display.cursorDiv.style.visibility = "hidden";
  }

  // HIGHLIGHT WORKER

  function startWorker(cm, time) {
    if (cm.doc.mode.startState && cm.doc.frontier < cm.display.viewTo)
      cm.state.highlight.set(time, bind(highlightWorker, cm));
  }

  function highlightWorker(cm) {
    var doc = cm.doc;
    if (doc.frontier < doc.first) doc.frontier = doc.first;
    if (doc.frontier >= cm.display.viewTo) return;
    var end = +new Date + cm.options.workTime;
    var state = copyState(doc.mode, getStateBefore(cm, doc.frontier));
    var changedLines = [];

    doc.iter(doc.frontier, Math.min(doc.first + doc.size, cm.display.viewTo + 500), function(line) {
      if (doc.frontier >= cm.display.viewFrom) { // Visible
        var oldStyles = line.styles, tooLong = line.text.length > cm.options.maxHighlightLength;
        var highlighted = highlightLine(cm, line, tooLong ? copyState(doc.mode, state) : state, true);
        line.styles = highlighted.styles;
        var oldCls = line.styleClasses, newCls = highlighted.classes;
        if (newCls) line.styleClasses = newCls;
        else if (oldCls) line.styleClasses = null;
        var ischange = !oldStyles || oldStyles.length != line.styles.length ||
          oldCls != newCls && (!oldCls || !newCls || oldCls.bgClass != newCls.bgClass || oldCls.textClass != newCls.textClass);
        for (var i = 0; !ischange && i < oldStyles.length; ++i) ischange = oldStyles[i] != line.styles[i];
        if (ischange) changedLines.push(doc.frontier);
        line.stateAfter = tooLong ? state : copyState(doc.mode, state);
      } else {
        if (line.text.length <= cm.options.maxHighlightLength)
          processLine(cm, line.text, state);
        line.stateAfter = doc.frontier % 5 == 0 ? copyState(doc.mode, state) : null;
      }
      ++doc.frontier;
      if (+new Date > end) {
        startWorker(cm, cm.options.workDelay);
        return true;
      }
    });
    if (changedLines.length) runInOp(cm, function() {
      for (var i = 0; i < changedLines.length; i++)
        regLineChange(cm, changedLines[i], "text");
    });
  }

  // Finds the line to start with when starting a parse. Tries to
  // find a line with a stateAfter, so that it can start with a
  // valid state. If that fails, it returns the line with the
  // smallest indentation, which tends to need the least context to
  // parse correctly.
  function findStartLine(cm, n, precise) {
    var minindent, minline, doc = cm.doc;
    var lim = precise ? -1 : n - (cm.doc.mode.innerMode ? 1000 : 100);
    for (var search = n; search > lim; --search) {
      if (search <= doc.first) return doc.first;
      var line = getLine(doc, search - 1);
      if (line.stateAfter && (!precise || search <= doc.frontier)) return search;
      var indented = countColumn(line.text, null, cm.options.tabSize);
      if (minline == null || minindent > indented) {
        minline = search - 1;
        minindent = indented;
      }
    }
    return minline;
  }

  function getStateBefore(cm, n, precise) {
    var doc = cm.doc, display = cm.display;
    if (!doc.mode.startState) return true;
    var pos = findStartLine(cm, n, precise), state = pos > doc.first && getLine(doc, pos-1).stateAfter;
    if (!state) state = startState(doc.mode);
    else state = copyState(doc.mode, state);
    doc.iter(pos, n, function(line) {
      processLine(cm, line.text, state);
      var save = pos == n - 1 || pos % 5 == 0 || pos >= display.viewFrom && pos < display.viewTo;
      line.stateAfter = save ? copyState(doc.mode, state) : null;
      ++pos;
    });
    if (precise) doc.frontier = pos;
    return state;
  }

  // POSITION MEASUREMENT

  function paddingTop(display) {return display.lineSpace.offsetTop;}
  function paddingVert(display) {return display.mover.offsetHeight - display.lineSpace.offsetHeight;}
  function paddingH(display) {
    if (display.cachedPaddingH) return display.cachedPaddingH;
    var e = removeChildrenAndAdd(display.measure, elt("pre", "x"));
    var style = window.getComputedStyle ? window.getComputedStyle(e) : e.currentStyle;
    var data = {left: parseInt(style.paddingLeft), right: parseInt(style.paddingRight)};
    if (!isNaN(data.left) && !isNaN(data.right)) display.cachedPaddingH = data;
    return data;
  }

  function scrollGap(cm) { return scrollerGap - cm.display.nativeBarWidth; }
  function displayWidth(cm) {
    return cm.display.scroller.clientWidth - scrollGap(cm) - cm.display.barWidth;
  }
  function displayHeight(cm) {
    return cm.display.scroller.clientHeight - scrollGap(cm) - cm.display.barHeight;
  }

  // Ensure the lineView.wrapping.heights array is populated. This is
  // an array of bottom offsets for the lines that make up a drawn
  // line. When lineWrapping is on, there might be more than one
  // height.
  function ensureLineHeights(cm, lineView, rect) {
    var wrapping = cm.options.lineWrapping;
    var curWidth = wrapping && displayWidth(cm);
    if (!lineView.measure.heights || wrapping && lineView.measure.width != curWidth) {
      var heights = lineView.measure.heights = [];
      if (wrapping) {
        lineView.measure.width = curWidth;
        var rects = lineView.text.firstChild.getClientRects();
        for (var i = 0; i < rects.length - 1; i++) {
          var cur = rects[i], next = rects[i + 1];
          if (Math.abs(cur.bottom - next.bottom) > 2)
            heights.push((cur.bottom + next.top) / 2 - rect.top);
        }
      }
      heights.push(rect.bottom - rect.top);
    }
  }

  // Find a line map (mapping character offsets to text nodes) and a
  // measurement cache for the given line number. (A line view might
  // contain multiple lines when collapsed ranges are present.)
  function mapFromLineView(lineView, line, lineN) {
    if (lineView.line == line)
      return {map: lineView.measure.map, cache: lineView.measure.cache};
    for (var i = 0; i < lineView.rest.length; i++)
      if (lineView.rest[i] == line)
        return {map: lineView.measure.maps[i], cache: lineView.measure.caches[i]};
    for (var i = 0; i < lineView.rest.length; i++)
      if (lineNo(lineView.rest[i]) > lineN)
        return {map: lineView.measure.maps[i], cache: lineView.measure.caches[i], before: true};
  }

  // Render a line into the hidden node display.externalMeasured. Used
  // when measurement is needed for a line that's not in the viewport.
  function updateExternalMeasurement(cm, line) {
    line = visualLine(line);
    var lineN = lineNo(line);
    var view = cm.display.externalMeasured = new LineView(cm.doc, line, lineN);
    view.lineN = lineN;
    var built = view.built = buildLineContent(cm, view);
    view.text = built.pre;
    removeChildrenAndAdd(cm.display.lineMeasure, built.pre);
    return view;
  }

  // Get a {top, bottom, left, right} box (in line-local coordinates)
  // for a given character.
  function measureChar(cm, line, ch, bias) {
    return measureCharPrepared(cm, prepareMeasureForLine(cm, line), ch, bias);
  }

  // Find a line view that corresponds to the given line number.
  function findViewForLine(cm, lineN) {
    if (lineN >= cm.display.viewFrom && lineN < cm.display.viewTo)
      return cm.display.view[findViewIndex(cm, lineN)];
    var ext = cm.display.externalMeasured;
    if (ext && lineN >= ext.lineN && lineN < ext.lineN + ext.size)
      return ext;
  }

  // Measurement can be split in two steps, the set-up work that
  // applies to the whole line, and the measurement of the actual
  // character. Functions like coordsChar, that need to do a lot of
  // measurements in a row, can thus ensure that the set-up work is
  // only done once.
  function prepareMeasureForLine(cm, line) {
    var lineN = lineNo(line);
    var view = findViewForLine(cm, lineN);
    if (view && !view.text) {
      view = null;
    } else if (view && view.changes) {
      updateLineForChanges(cm, view, lineN, getDimensions(cm));
      cm.curOp.forceUpdate = true;
    }
    if (!view)
      view = updateExternalMeasurement(cm, line);

    var info = mapFromLineView(view, line, lineN);
    return {
      line: line, view: view, rect: null,
      map: info.map, cache: info.cache, before: info.before,
      hasHeights: false
    };
  }

  // Given a prepared measurement object, measures the position of an
  // actual character (or fetches it from the cache).
  function measureCharPrepared(cm, prepared, ch, bias, varHeight) {
    if (prepared.before) ch = -1;
    var key = ch + (bias || ""), found;
    if (prepared.cache.hasOwnProperty(key)) {
      found = prepared.cache[key];
    } else {
      if (!prepared.rect)
        prepared.rect = prepared.view.text.getBoundingClientRect();
      if (!prepared.hasHeights) {
        ensureLineHeights(cm, prepared.view, prepared.rect);
        prepared.hasHeights = true;
      }
      found = measureCharInner(cm, prepared, ch, bias);
      if (!found.bogus) prepared.cache[key] = found;
    }
    return {left: found.left, right: found.right,
            top: varHeight ? found.rtop : found.top,
            bottom: varHeight ? found.rbottom : found.bottom};
  }

  var nullRect = {left: 0, right: 0, top: 0, bottom: 0};

  function nodeAndOffsetInLineMap(map, ch, bias) {
    var node, start, end, collapse;
    // First, search the line map for the text node corresponding to,
    // or closest to, the target character.
    for (var i = 0; i < map.length; i += 3) {
      var mStart = map[i], mEnd = map[i + 1];
      if (ch < mStart) {
        start = 0; end = 1;
        collapse = "left";
      } else if (ch < mEnd) {
        start = ch - mStart;
        end = start + 1;
      } else if (i == map.length - 3 || ch == mEnd && map[i + 3] > ch) {
        end = mEnd - mStart;
        start = end - 1;
        if (ch >= mEnd) collapse = "right";
      }
      if (start != null) {
        node = map[i + 2];
        if (mStart == mEnd && bias == (node.insertLeft ? "left" : "right"))
          collapse = bias;
        if (bias == "left" && start == 0)
          while (i && map[i - 2] == map[i - 3] && map[i - 1].insertLeft) {
            node = map[(i -= 3) + 2];
            collapse = "left";
          }
        if (bias == "right" && start == mEnd - mStart)
          while (i < map.length - 3 && map[i + 3] == map[i + 4] && !map[i + 5].insertLeft) {
            node = map[(i += 3) + 2];
            collapse = "right";
          }
        break;
      }
    }
    return {node: node, start: start, end: end, collapse: collapse, coverStart: mStart, coverEnd: mEnd};
  }

  function measureCharInner(cm, prepared, ch, bias) {
    var place = nodeAndOffsetInLineMap(prepared.map, ch, bias);
    var node = place.node, start = place.start, end = place.end, collapse = place.collapse;

    var rect;
    if (node.nodeType == 3) { // If it is a text node, use a range to retrieve the coordinates.
      for (var i = 0; i < 4; i++) { // Retry a maximum of 4 times when nonsense rectangles are returned
        while (start && isExtendingChar(prepared.line.text.charAt(place.coverStart + start))) --start;
        while (place.coverStart + end < place.coverEnd && isExtendingChar(prepared.line.text.charAt(place.coverStart + end))) ++end;
        if (ie && ie_version < 9 && start == 0 && end == place.coverEnd - place.coverStart) {
          rect = node.parentNode.getBoundingClientRect();
        } else if (ie && cm.options.lineWrapping) {
          var rects = range(node, start, end).getClientRects();
          if (rects.length)
            rect = rects[bias == "right" ? rects.length - 1 : 0];
          else
            rect = nullRect;
        } else {
          rect = range(node, start, end).getBoundingClientRect() || nullRect;
        }
        if (rect.left || rect.right || start == 0) break;
        end = start;
        start = start - 1;
        collapse = "right";
      }
      if (ie && ie_version < 11) rect = maybeUpdateRectForZooming(cm.display.measure, rect);
    } else { // If it is a widget, simply get the box for the whole widget.
      if (start > 0) collapse = bias = "right";
      var rects;
      if (cm.options.lineWrapping && (rects = node.getClientRects()).length > 1)
        rect = rects[bias == "right" ? rects.length - 1 : 0];
      else
        rect = node.getBoundingClientRect();
    }
    if (ie && ie_version < 9 && !start && (!rect || !rect.left && !rect.right)) {
      var rSpan = node.parentNode.getClientRects()[0];
      if (rSpan)
        rect = {left: rSpan.left, right: rSpan.left + charWidth(cm.display), top: rSpan.top, bottom: rSpan.bottom};
      else
        rect = nullRect;
    }

    var rtop = rect.top - prepared.rect.top, rbot = rect.bottom - prepared.rect.top;
    var mid = (rtop + rbot) / 2;
    var heights = prepared.view.measure.heights;
    for (var i = 0; i < heights.length - 1; i++)
      if (mid < heights[i]) break;
    var top = i ? heights[i - 1] : 0, bot = heights[i];
    var result = {left: (collapse == "right" ? rect.right : rect.left) - prepared.rect.left,
                  right: (collapse == "left" ? rect.left : rect.right) - prepared.rect.left,
                  top: top, bottom: bot};
    if (!rect.left && !rect.right) result.bogus = true;
    if (!cm.options.singleCursorHeightPerLine) { result.rtop = rtop; result.rbottom = rbot; }

    return result;
  }

  // Work around problem with bounding client rects on ranges being
  // returned incorrectly when zoomed on IE10 and below.
  function maybeUpdateRectForZooming(measure, rect) {
    if (!window.screen || screen.logicalXDPI == null ||
        screen.logicalXDPI == screen.deviceXDPI || !hasBadZoomedRects(measure))
      return rect;
    var scaleX = screen.logicalXDPI / screen.deviceXDPI;
    var scaleY = screen.logicalYDPI / screen.deviceYDPI;
    return {left: rect.left * scaleX, right: rect.right * scaleX,
            top: rect.top * scaleY, bottom: rect.bottom * scaleY};
  }

  function clearLineMeasurementCacheFor(lineView) {
    if (lineView.measure) {
      lineView.measure.cache = {};
      lineView.measure.heights = null;
      if (lineView.rest) for (var i = 0; i < lineView.rest.length; i++)
        lineView.measure.caches[i] = {};
    }
  }

  function clearLineMeasurementCache(cm) {
    cm.display.externalMeasure = null;
    removeChildren(cm.display.lineMeasure);
    for (var i = 0; i < cm.display.view.length; i++)
      clearLineMeasurementCacheFor(cm.display.view[i]);
  }

  function clearCaches(cm) {
    clearLineMeasurementCache(cm);
    cm.display.cachedCharWidth = cm.display.cachedTextHeight = cm.display.cachedPaddingH = null;
    if (!cm.options.lineWrapping) cm.display.maxLineChanged = true;
    cm.display.lineNumChars = null;
  }

  function pageScrollX() { return window.pageXOffset || (document.documentElement || document.body).scrollLeft; }
  function pageScrollY() { return window.pageYOffset || (document.documentElement || document.body).scrollTop; }

  // Converts a {top, bottom, left, right} box from line-local
  // coordinates into another coordinate system. Context may be one of
  // "line", "div" (display.lineDiv), "local"/null (editor), "window",
  // or "page".
  function intoCoordSystem(cm, lineObj, rect, context) {
    if (lineObj.widgets) for (var i = 0; i < lineObj.widgets.length; ++i) if (lineObj.widgets[i].above) {
      var size = widgetHeight(lineObj.widgets[i]);
      rect.top += size; rect.bottom += size;
    }
    if (context == "line") return rect;
    if (!context) context = "local";
    var yOff = heightAtLine(lineObj);
    if (context == "local") yOff += paddingTop(cm.display);
    else yOff -= cm.display.viewOffset;
    if (context == "page" || context == "window") {
      var lOff = cm.display.lineSpace.getBoundingClientRect();
      yOff += lOff.top + (context == "window" ? 0 : pageScrollY());
      var xOff = lOff.left + (context == "window" ? 0 : pageScrollX());
      rect.left += xOff; rect.right += xOff;
    }
    rect.top += yOff; rect.bottom += yOff;
    return rect;
  }

  // Coverts a box from "div" coords to another coordinate system.
  // Context may be "window", "page", "div", or "local"/null.
  function fromCoordSystem(cm, coords, context) {
    if (context == "div") return coords;
    var left = coords.left, top = coords.top;
    // First move into "page" coordinate system
    if (context == "page") {
      left -= pageScrollX();
      top -= pageScrollY();
    } else if (context == "local" || !context) {
      var localBox = cm.display.sizer.getBoundingClientRect();
      left += localBox.left;
      top += localBox.top;
    }

    var lineSpaceBox = cm.display.lineSpace.getBoundingClientRect();
    return {left: left - lineSpaceBox.left, top: top - lineSpaceBox.top};
  }

  function charCoords(cm, pos, context, lineObj, bias) {
    if (!lineObj) lineObj = getLine(cm.doc, pos.line);
    return intoCoordSystem(cm, lineObj, measureChar(cm, lineObj, pos.ch, bias), context);
  }

  // Returns a box for a given cursor position, which may have an
  // 'other' property containing the position of the secondary cursor
  // on a bidi boundary.
  function cursorCoords(cm, pos, context, lineObj, preparedMeasure, varHeight) {
    lineObj = lineObj || getLine(cm.doc, pos.line);
    if (!preparedMeasure) preparedMeasure = prepareMeasureForLine(cm, lineObj);
    function get(ch, right) {
      var m = measureCharPrepared(cm, preparedMeasure, ch, right ? "right" : "left", varHeight);
      if (right) m.left = m.right; else m.right = m.left;
      return intoCoordSystem(cm, lineObj, m, context);
    }
    function getBidi(ch, partPos) {
      var part = order[partPos], right = part.level % 2;
      if (ch == bidiLeft(part) && partPos && part.level < order[partPos - 1].level) {
        part = order[--partPos];
        ch = bidiRight(part) - (part.level % 2 ? 0 : 1);
        right = true;
      } else if (ch == bidiRight(part) && partPos < order.length - 1 && part.level < order[partPos + 1].level) {
        part = order[++partPos];
        ch = bidiLeft(part) - part.level % 2;
        right = false;
      }
      if (right && ch == part.to && ch > part.from) return get(ch - 1);
      return get(ch, right);
    }
    var order = getOrder(lineObj), ch = pos.ch;
    if (!order) return get(ch);
    var partPos = getBidiPartAt(order, ch);
    var val = getBidi(ch, partPos);
    if (bidiOther != null) val.other = getBidi(ch, bidiOther);
    return val;
  }

  // Used to cheaply estimate the coordinates for a position. Used for
  // intermediate scroll updates.
  function estimateCoords(cm, pos) {
    var left = 0, pos = clipPos(cm.doc, pos);
    if (!cm.options.lineWrapping) left = charWidth(cm.display) * pos.ch;
    var lineObj = getLine(cm.doc, pos.line);
    var top = heightAtLine(lineObj) + paddingTop(cm.display);
    return {left: left, right: left, top: top, bottom: top + lineObj.height};
  }

  // Positions returned by coordsChar contain some extra information.
  // xRel is the relative x position of the input coordinates compared
  // to the found position (so xRel > 0 means the coordinates are to
  // the right of the character position, for example). When outside
  // is true, that means the coordinates lie outside the line's
  // vertical range.
  function PosWithInfo(line, ch, outside, xRel) {
    var pos = Pos(line, ch);
    pos.xRel = xRel;
    if (outside) pos.outside = true;
    return pos;
  }

  // Compute the character position closest to the given coordinates.
  // Input must be lineSpace-local ("div" coordinate system).
  function coordsChar(cm, x, y) {
    var doc = cm.doc;
    y += cm.display.viewOffset;
    if (y < 0) return PosWithInfo(doc.first, 0, true, -1);
    var lineN = lineAtHeight(doc, y), last = doc.first + doc.size - 1;
    if (lineN > last)
      return PosWithInfo(doc.first + doc.size - 1, getLine(doc, last).text.length, true, 1);
    if (x < 0) x = 0;

    var lineObj = getLine(doc, lineN);
    for (;;) {
      var found = coordsCharInner(cm, lineObj, lineN, x, y);
      var merged = collapsedSpanAtEnd(lineObj);
      var mergedPos = merged && merged.find(0, true);
      if (merged && (found.ch > mergedPos.from.ch || found.ch == mergedPos.from.ch && found.xRel > 0))
        lineN = lineNo(lineObj = mergedPos.to.line);
      else
        return found;
    }
  }

  function coordsCharInner(cm, lineObj, lineNo, x, y) {
    var innerOff = y - heightAtLine(lineObj);
    var wrongLine = false, adjust = 2 * cm.display.wrapper.clientWidth;
    var preparedMeasure = prepareMeasureForLine(cm, lineObj);

    function getX(ch) {
      var sp = cursorCoords(cm, Pos(lineNo, ch), "line", lineObj, preparedMeasure);
      wrongLine = true;
      if (innerOff > sp.bottom) return sp.left - adjust;
      else if (innerOff < sp.top) return sp.left + adjust;
      else wrongLine = false;
      return sp.left;
    }

    var bidi = getOrder(lineObj), dist = lineObj.text.length;
    var from = lineLeft(lineObj), to = lineRight(lineObj);
    var fromX = getX(from), fromOutside = wrongLine, toX = getX(to), toOutside = wrongLine;

    if (x > toX) return PosWithInfo(lineNo, to, toOutside, 1);
    // Do a binary search between these bounds.
    for (;;) {
      if (bidi ? to == from || to == moveVisually(lineObj, from, 1) : to - from <= 1) {
        var ch = x < fromX || x - fromX <= toX - x ? from : to;
        var xDiff = x - (ch == from ? fromX : toX);
        while (isExtendingChar(lineObj.text.charAt(ch))) ++ch;
        var pos = PosWithInfo(lineNo, ch, ch == from ? fromOutside : toOutside,
                              xDiff < -1 ? -1 : xDiff > 1 ? 1 : 0);
        return pos;
      }
      var step = Math.ceil(dist / 2), middle = from + step;
      if (bidi) {
        middle = from;
        for (var i = 0; i < step; ++i) middle = moveVisually(lineObj, middle, 1);
      }
      var middleX = getX(middle);
      if (middleX > x) {to = middle; toX = middleX; if (toOutside = wrongLine) toX += 1000; dist = step;}
      else {from = middle; fromX = middleX; fromOutside = wrongLine; dist -= step;}
    }
  }

  var measureText;
  // Compute the default text height.
  function textHeight(display) {
    if (display.cachedTextHeight != null) return display.cachedTextHeight;
    if (measureText == null) {
      measureText = elt("pre");
      // Measure a bunch of lines, for browsers that compute
      // fractional heights.
      for (var i = 0; i < 49; ++i) {
        measureText.appendChild(document.createTextNode("x"));
        measureText.appendChild(elt("br"));
      }
      measureText.appendChild(document.createTextNode("x"));
    }
    removeChildrenAndAdd(display.measure, measureText);
    var height = measureText.offsetHeight / 50;
    if (height > 3) display.cachedTextHeight = height;
    removeChildren(display.measure);
    return height || 1;
  }

  // Compute the default character width.
  function charWidth(display) {
    if (display.cachedCharWidth != null) return display.cachedCharWidth;
    var anchor = elt("span", "xxxxxxxxxx");
    var pre = elt("pre", [anchor]);
    removeChildrenAndAdd(display.measure, pre);
    var rect = anchor.getBoundingClientRect(), width = (rect.right - rect.left) / 10;
    if (width > 2) display.cachedCharWidth = width;
    return width || 10;
  }

  // OPERATIONS

  // Operations are used to wrap a series of changes to the editor
  // state in such a way that each change won't have to update the
  // cursor and display (which would be awkward, slow, and
  // error-prone). Instead, display updates are batched and then all
  // combined and executed at once.

  var operationGroup = null;

  var nextOpId = 0;
  // Start a new operation.
  function startOperation(cm) {
    cm.curOp = {
      cm: cm,
      viewChanged: false,      // Flag that indicates that lines might need to be redrawn
      startHeight: cm.doc.height, // Used to detect need to update scrollbar
      forceUpdate: false,      // Used to force a redraw
      updateInput: null,       // Whether to reset the input textarea
      typing: false,           // Whether this reset should be careful to leave existing text (for compositing)
      changeObjs: null,        // Accumulated changes, for firing change events
      cursorActivityHandlers: null, // Set of handlers to fire cursorActivity on
      cursorActivityCalled: 0, // Tracks which cursorActivity handlers have been called already
      selectionChanged: false, // Whether the selection needs to be redrawn
      updateMaxLine: false,    // Set when the widest line needs to be determined anew
      scrollLeft: null, scrollTop: null, // Intermediate scroll position, not pushed to DOM yet
      scrollToPos: null,       // Used to scroll to a specific position
      focus: false,
      id: ++nextOpId           // Unique ID
    };
    if (operationGroup) {
      operationGroup.ops.push(cm.curOp);
    } else {
      cm.curOp.ownsGroup = operationGroup = {
        ops: [cm.curOp],
        delayedCallbacks: []
      };
    }
  }

  function fireCallbacksForOps(group) {
    // Calls delayed callbacks and cursorActivity handlers until no
    // new ones appear
    var callbacks = group.delayedCallbacks, i = 0;
    do {
      for (; i < callbacks.length; i++)
        callbacks[i].call(null);
      for (var j = 0; j < group.ops.length; j++) {
        var op = group.ops[j];
        if (op.cursorActivityHandlers)
          while (op.cursorActivityCalled < op.cursorActivityHandlers.length)
            op.cursorActivityHandlers[op.cursorActivityCalled++].call(null, op.cm);
      }
    } while (i < callbacks.length);
  }

  // Finish an operation, updating the display and signalling delayed events
  function endOperation(cm) {
    var op = cm.curOp, group = op.ownsGroup;
    if (!group) return;

    try { fireCallbacksForOps(group); }
    finally {
      operationGroup = null;
      for (var i = 0; i < group.ops.length; i++)
        group.ops[i].cm.curOp = null;
      endOperations(group);
    }
  }

  // The DOM updates done when an operation finishes are batched so
  // that the minimum number of relayouts are required.
  function endOperations(group) {
    var ops = group.ops;
    for (var i = 0; i < ops.length; i++) // Read DOM
      endOperation_R1(ops[i]);
    for (var i = 0; i < ops.length; i++) // Write DOM (maybe)
      endOperation_W1(ops[i]);
    for (var i = 0; i < ops.length; i++) // Read DOM
      endOperation_R2(ops[i]);
    for (var i = 0; i < ops.length; i++) // Write DOM (maybe)
      endOperation_W2(ops[i]);
    for (var i = 0; i < ops.length; i++) // Read DOM
      endOperation_finish(ops[i]);
  }

  function endOperation_R1(op) {
    var cm = op.cm, display = cm.display;
    maybeClipScrollbars(cm);
    if (op.updateMaxLine) findMaxLine(cm);

    op.mustUpdate = op.viewChanged || op.forceUpdate || op.scrollTop != null ||
      op.scrollToPos && (op.scrollToPos.from.line < display.viewFrom ||
                         op.scrollToPos.to.line >= display.viewTo) ||
      display.maxLineChanged && cm.options.lineWrapping;
    op.update = op.mustUpdate &&
      new DisplayUpdate(cm, op.mustUpdate && {top: op.scrollTop, ensure: op.scrollToPos}, op.forceUpdate);
  }

  function endOperation_W1(op) {
    op.updatedDisplay = op.mustUpdate && updateDisplayIfNeeded(op.cm, op.update);
  }

  function endOperation_R2(op) {
    var cm = op.cm, display = cm.display;
    if (op.updatedDisplay) updateHeightsInViewport(cm);

    op.barMeasure = measureForScrollbars(cm);

    // If the max line changed since it was last measured, measure it,
    // and ensure the document's width matches it.
    // updateDisplay_W2 will use these properties to do the actual resizing
    if (display.maxLineChanged && !cm.options.lineWrapping) {
      op.adjustWidthTo = measureChar(cm, display.maxLine, display.maxLine.text.length).left + 3;
      cm.display.sizerWidth = op.adjustWidthTo;
      op.barMeasure.scrollWidth =
        Math.max(display.scroller.clientWidth, display.sizer.offsetLeft + op.adjustWidthTo + scrollGap(cm) + cm.display.barWidth);
      op.maxScrollLeft = Math.max(0, display.sizer.offsetLeft + op.adjustWidthTo - displayWidth(cm));
    }

    if (op.updatedDisplay || op.selectionChanged)
      op.preparedSelection = display.input.prepareSelection();
  }

  function endOperation_W2(op) {
    var cm = op.cm;

    if (op.adjustWidthTo != null) {
      cm.display.sizer.style.minWidth = op.adjustWidthTo + "px";
      if (op.maxScrollLeft < cm.doc.scrollLeft)
        setScrollLeft(cm, Math.min(cm.display.scroller.scrollLeft, op.maxScrollLeft), true);
      cm.display.maxLineChanged = false;
    }

    if (op.preparedSelection)
      cm.display.input.showSelection(op.preparedSelection);
    if (op.updatedDisplay)
      setDocumentHeight(cm, op.barMeasure);
    if (op.updatedDisplay || op.startHeight != cm.doc.height)
      updateScrollbars(cm, op.barMeasure);

    if (op.selectionChanged) restartBlink(cm);

    if (cm.state.focused && op.updateInput)
      cm.display.input.reset(op.typing);
    if (op.focus && op.focus == activeElt()) ensureFocus(op.cm);
  }

  function endOperation_finish(op) {
    var cm = op.cm, display = cm.display, doc = cm.doc;

    if (op.updatedDisplay) postUpdateDisplay(cm, op.update);

    // Abort mouse wheel delta measurement, when scrolling explicitly
    if (display.wheelStartX != null && (op.scrollTop != null || op.scrollLeft != null || op.scrollToPos))
      display.wheelStartX = display.wheelStartY = null;

    // Propagate the scroll position to the actual DOM scroller
    if (op.scrollTop != null && (display.scroller.scrollTop != op.scrollTop || op.forceScroll)) {
      doc.scrollTop = Math.max(0, Math.min(display.scroller.scrollHeight - display.scroller.clientHeight, op.scrollTop));
      display.scrollbars.setScrollTop(doc.scrollTop);
      display.scroller.scrollTop = doc.scrollTop;
    }
    if (op.scrollLeft != null && (display.scroller.scrollLeft != op.scrollLeft || op.forceScroll)) {
      doc.scrollLeft = Math.max(0, Math.min(display.scroller.scrollWidth - displayWidth(cm), op.scrollLeft));
      display.scrollbars.setScrollLeft(doc.scrollLeft);
      display.scroller.scrollLeft = doc.scrollLeft;
      alignHorizontally(cm);
    }
    // If we need to scroll a specific position into view, do so.
    if (op.scrollToPos) {
      var coords = scrollPosIntoView(cm, clipPos(doc, op.scrollToPos.from),
                                     clipPos(doc, op.scrollToPos.to), op.scrollToPos.margin);
      if (op.scrollToPos.isCursor && cm.state.focused) maybeScrollWindow(cm, coords);
    }

    // Fire events for markers that are hidden/unidden by editing or
    // undoing
    var hidden = op.maybeHiddenMarkers, unhidden = op.maybeUnhiddenMarkers;
    if (hidden) for (var i = 0; i < hidden.length; ++i)
      if (!hidden[i].lines.length) signal(hidden[i], "hide");
    if (unhidden) for (var i = 0; i < unhidden.length; ++i)
      if (unhidden[i].lines.length) signal(unhidden[i], "unhide");

    if (display.wrapper.offsetHeight)
      doc.scrollTop = cm.display.scroller.scrollTop;

    // Fire change events, and delayed event handlers
    if (op.changeObjs)
      signal(cm, "changes", cm, op.changeObjs);
    if (op.update)
      op.update.finish();
  }

  // Run the given function in an operation
  function runInOp(cm, f) {
    if (cm.curOp) return f();
    startOperation(cm);
    try { return f(); }
    finally { endOperation(cm); }
  }
  // Wraps a function in an operation. Returns the wrapped function.
  function operation(cm, f) {
    return function() {
      if (cm.curOp) return f.apply(cm, arguments);
      startOperation(cm);
      try { return f.apply(cm, arguments); }
      finally { endOperation(cm); }
    };
  }
  // Used to add methods to editor and doc instances, wrapping them in
  // operations.
  function methodOp(f) {
    return function() {
      if (this.curOp) return f.apply(this, arguments);
      startOperation(this);
      try { return f.apply(this, arguments); }
      finally { endOperation(this); }
    };
  }
  function docMethodOp(f) {
    return function() {
      var cm = this.cm;
      if (!cm || cm.curOp) return f.apply(this, arguments);
      startOperation(cm);
      try { return f.apply(this, arguments); }
      finally { endOperation(cm); }
    };
  }

  // VIEW TRACKING

  // These objects are used to represent the visible (currently drawn)
  // part of the document. A LineView may correspond to multiple
  // logical lines, if those are connected by collapsed ranges.
  function LineView(doc, line, lineN) {
    // The starting line
    this.line = line;
    // Continuing lines, if any
    this.rest = visualLineContinued(line);
    // Number of logical lines in this visual line
    this.size = this.rest ? lineNo(lst(this.rest)) - lineN + 1 : 1;
    this.node = this.text = null;
    this.hidden = lineIsHidden(doc, line);
  }

  // Create a range of LineView objects for the given lines.
  function buildViewArray(cm, from, to) {
    var array = [], nextPos;
    for (var pos = from; pos < to; pos = nextPos) {
      var view = new LineView(cm.doc, getLine(cm.doc, pos), pos);
      nextPos = pos + view.size;
      array.push(view);
    }
    return array;
  }

  // Updates the display.view data structure for a given change to the
  // document. From and to are in pre-change coordinates. Lendiff is
  // the amount of lines added or subtracted by the change. This is
  // used for changes that span multiple lines, or change the way
  // lines are divided into visual lines. regLineChange (below)
  // registers single-line changes.
  function regChange(cm, from, to, lendiff) {
    if (from == null) from = cm.doc.first;
    if (to == null) to = cm.doc.first + cm.doc.size;
    if (!lendiff) lendiff = 0;

    var display = cm.display;
    if (lendiff && to < display.viewTo &&
        (display.updateLineNumbers == null || display.updateLineNumbers > from))
      display.updateLineNumbers = from;

    cm.curOp.viewChanged = true;

    if (from >= display.viewTo) { // Change after
      if (sawCollapsedSpans && visualLineNo(cm.doc, from) < display.viewTo)
        resetView(cm);
    } else if (to <= display.viewFrom) { // Change before
      if (sawCollapsedSpans && visualLineEndNo(cm.doc, to + lendiff) > display.viewFrom) {
        resetView(cm);
      } else {
        display.viewFrom += lendiff;
        display.viewTo += lendiff;
      }
    } else if (from <= display.viewFrom && to >= display.viewTo) { // Full overlap
      resetView(cm);
    } else if (from <= display.viewFrom) { // Top overlap
      var cut = viewCuttingPoint(cm, to, to + lendiff, 1);
      if (cut) {
        display.view = display.view.slice(cut.index);
        display.viewFrom = cut.lineN;
        display.viewTo += lendiff;
      } else {
        resetView(cm);
      }
    } else if (to >= display.viewTo) { // Bottom overlap
      var cut = viewCuttingPoint(cm, from, from, -1);
      if (cut) {
        display.view = display.view.slice(0, cut.index);
        display.viewTo = cut.lineN;
      } else {
        resetView(cm);
      }
    } else { // Gap in the middle
      var cutTop = viewCuttingPoint(cm, from, from, -1);
      var cutBot = viewCuttingPoint(cm, to, to + lendiff, 1);
      if (cutTop && cutBot) {
        display.view = display.view.slice(0, cutTop.index)
          .concat(buildViewArray(cm, cutTop.lineN, cutBot.lineN))
          .concat(display.view.slice(cutBot.index));
        display.viewTo += lendiff;
      } else {
        resetView(cm);
      }
    }

    var ext = display.externalMeasured;
    if (ext) {
      if (to < ext.lineN)
        ext.lineN += lendiff;
      else if (from < ext.lineN + ext.size)
        display.externalMeasured = null;
    }
  }

  // Register a change to a single line. Type must be one of "text",
  // "gutter", "class", "widget"
  function regLineChange(cm, line, type) {
    cm.curOp.viewChanged = true;
    var display = cm.display, ext = cm.display.externalMeasured;
    if (ext && line >= ext.lineN && line < ext.lineN + ext.size)
      display.externalMeasured = null;

    if (line < display.viewFrom || line >= display.viewTo) return;
    var lineView = display.view[findViewIndex(cm, line)];
    if (lineView.node == null) return;
    var arr = lineView.changes || (lineView.changes = []);
    if (indexOf(arr, type) == -1) arr.push(type);
  }

  // Clear the view.
  function resetView(cm) {
    cm.display.viewFrom = cm.display.viewTo = cm.doc.first;
    cm.display.view = [];
    cm.display.viewOffset = 0;
  }

  // Find the view element corresponding to a given line. Return null
  // when the line isn't visible.
  function findViewIndex(cm, n) {
    if (n >= cm.display.viewTo) return null;
    n -= cm.display.viewFrom;
    if (n < 0) return null;
    var view = cm.display.view;
    for (var i = 0; i < view.length; i++) {
      n -= view[i].size;
      if (n < 0) return i;
    }
  }

  function viewCuttingPoint(cm, oldN, newN, dir) {
    var index = findViewIndex(cm, oldN), diff, view = cm.display.view;
    if (!sawCollapsedSpans || newN == cm.doc.first + cm.doc.size)
      return {index: index, lineN: newN};
    for (var i = 0, n = cm.display.viewFrom; i < index; i++)
      n += view[i].size;
    if (n != oldN) {
      if (dir > 0) {
        if (index == view.length - 1) return null;
        diff = (n + view[index].size) - oldN;
        index++;
      } else {
        diff = n - oldN;
      }
      oldN += diff; newN += diff;
    }
    while (visualLineNo(cm.doc, newN) != newN) {
      if (index == (dir < 0 ? 0 : view.length - 1)) return null;
      newN += dir * view[index - (dir < 0 ? 1 : 0)].size;
      index += dir;
    }
    return {index: index, lineN: newN};
  }

  // Force the view to cover a given range, adding empty view element
  // or clipping off existing ones as needed.
  function adjustView(cm, from, to) {
    var display = cm.display, view = display.view;
    if (view.length == 0 || from >= display.viewTo || to <= display.viewFrom) {
      display.view = buildViewArray(cm, from, to);
      display.viewFrom = from;
    } else {
      if (display.viewFrom > from)
        display.view = buildViewArray(cm, from, display.viewFrom).concat(display.view);
      else if (display.viewFrom < from)
        display.view = display.view.slice(findViewIndex(cm, from));
      display.viewFrom = from;
      if (display.viewTo < to)
        display.view = display.view.concat(buildViewArray(cm, display.viewTo, to));
      else if (display.viewTo > to)
        display.view = display.view.slice(0, findViewIndex(cm, to));
    }
    display.viewTo = to;
  }

  // Count the number of lines in the view whose DOM representation is
  // out of date (or nonexistent).
  function countDirtyView(cm) {
    var view = cm.display.view, dirty = 0;
    for (var i = 0; i < view.length; i++) {
      var lineView = view[i];
      if (!lineView.hidden && (!lineView.node || lineView.changes)) ++dirty;
    }
    return dirty;
  }

  // EVENT HANDLERS

  // Attach the necessary event handlers when initializing the editor
  function registerEventHandlers(cm) {
    var d = cm.display;
    on(d.scroller, "mousedown", operation(cm, onMouseDown));
    // Older IE's will not fire a second mousedown for a double click
    if (ie && ie_version < 11)
      on(d.scroller, "dblclick", operation(cm, function(e) {
        if (signalDOMEvent(cm, e)) return;
        var pos = posFromMouse(cm, e);
        if (!pos || clickInGutter(cm, e) || eventInWidget(cm.display, e)) return;
        e_preventDefault(e);
        var word = cm.findWordAt(pos);
        extendSelection(cm.doc, word.anchor, word.head);
      }));
    else
      on(d.scroller, "dblclick", function(e) { signalDOMEvent(cm, e) || e_preventDefault(e); });
    // Some browsers fire contextmenu *after* opening the menu, at
    // which point we can't mess with it anymore. Context menu is
    // handled in onMouseDown for these browsers.
    if (!captureRightClick) on(d.scroller, "contextmenu", function(e) {onContextMenu(cm, e);});

    // Used to suppress mouse event handling when a touch happens
    var touchFinished, prevTouch = {end: 0};
    function finishTouch() {
      if (d.activeTouch) {
        touchFinished = setTimeout(function() {d.activeTouch = null;}, 1000);
        prevTouch = d.activeTouch;
        prevTouch.end = +new Date;
      }
    };
    function isMouseLikeTouchEvent(e) {
      if (e.touches.length != 1) return false;
      var touch = e.touches[0];
      return touch.radiusX <= 1 && touch.radiusY <= 1;
    }
    function farAway(touch, other) {
      if (other.left == null) return true;
      var dx = other.left - touch.left, dy = other.top - touch.top;
      return dx * dx + dy * dy > 20 * 20;
    }
    on(d.scroller, "touchstart", function(e) {
      if (!isMouseLikeTouchEvent(e)) {
        clearTimeout(touchFinished);
        var now = +new Date;
        d.activeTouch = {start: now, moved: false,
                         prev: now - prevTouch.end <= 300 ? prevTouch : null};
        if (e.touches.length == 1) {
          d.activeTouch.left = e.touches[0].pageX;
          d.activeTouch.top = e.touches[0].pageY;
        }
      }
    });
    on(d.scroller, "touchmove", function() {
      if (d.activeTouch) d.activeTouch.moved = true;
    });
    on(d.scroller, "touchend", function(e) {
      var touch = d.activeTouch;
      if (touch && !eventInWidget(d, e) && touch.left != null &&
          !touch.moved && new Date - touch.start < 300) {
        var pos = cm.coordsChar(d.activeTouch, "page"), range;
        if (!touch.prev || farAway(touch, touch.prev)) // Single tap
          range = new Range(pos, pos);
        else if (!touch.prev.prev || farAway(touch, touch.prev.prev)) // Double tap
          range = cm.findWordAt(pos);
        else // Triple tap
          range = new Range(Pos(pos.line, 0), clipPos(cm.doc, Pos(pos.line + 1, 0)));
        cm.setSelection(range.anchor, range.head);
        cm.focus();
        e_preventDefault(e);
      }
      finishTouch();
    });
    on(d.scroller, "touchcancel", finishTouch);

    // Sync scrolling between fake scrollbars and real scrollable
    // area, ensure viewport is updated when scrolling.
    on(d.scroller, "scroll", function() {
      if (d.scroller.clientHeight) {
        setScrollTop(cm, d.scroller.scrollTop);
        setScrollLeft(cm, d.scroller.scrollLeft, true);
        signal(cm, "scroll", cm);
      }
    });

    // Listen to wheel events in order to try and update the viewport on time.
    on(d.scroller, "mousewheel", function(e){onScrollWheel(cm, e);});
    on(d.scroller, "DOMMouseScroll", function(e){onScrollWheel(cm, e);});

    // Prevent wrapper from ever scrolling
    on(d.wrapper, "scroll", function() { d.wrapper.scrollTop = d.wrapper.scrollLeft = 0; });

    d.dragFunctions = {
      enter: function(e) {if (!signalDOMEvent(cm, e)) e_stop(e);},
      over: function(e) {if (!signalDOMEvent(cm, e)) { onDragOver(cm, e); e_stop(e); }},
      start: function(e){onDragStart(cm, e);},
      drop: operation(cm, onDrop),
      leave: function() {clearDragCursor(cm);}
    };

    var inp = d.input.getField();
    on(inp, "keyup", function(e) { onKeyUp.call(cm, e); });
    on(inp, "keydown", operation(cm, onKeyDown));
    on(inp, "keypress", operation(cm, onKeyPress));
    on(inp, "focus", bind(onFocus, cm));
    on(inp, "blur", bind(onBlur, cm));
  }

  function dragDropChanged(cm, value, old) {
    var wasOn = old && old != CodeMirror.Init;
    if (!value != !wasOn) {
      var funcs = cm.display.dragFunctions;
      var toggle = value ? on : off;
      toggle(cm.display.scroller, "dragstart", funcs.start);
      toggle(cm.display.scroller, "dragenter", funcs.enter);
      toggle(cm.display.scroller, "dragover", funcs.over);
      toggle(cm.display.scroller, "dragleave", funcs.leave);
      toggle(cm.display.scroller, "drop", funcs.drop);
    }
  }

  // Called when the window resizes
  function onResize(cm) {
    var d = cm.display;
    if (d.lastWrapHeight == d.wrapper.clientHeight && d.lastWrapWidth == d.wrapper.clientWidth)
      return;
    // Might be a text scaling operation, clear size caches.
    d.cachedCharWidth = d.cachedTextHeight = d.cachedPaddingH = null;
    d.scrollbarsClipped = false;
    cm.setSize();
  }

  // MOUSE EVENTS

  // Return true when the given mouse event happened in a widget
  function eventInWidget(display, e) {
    for (var n = e_target(e); n != display.wrapper; n = n.parentNode) {
      if (!n || (n.nodeType == 1 && n.getAttribute("cm-ignore-events") == "true") ||
          (n.parentNode == display.sizer && n != display.mover))
        return true;
    }
  }

  // Given a mouse event, find the corresponding position. If liberal
  // is false, it checks whether a gutter or scrollbar was clicked,
  // and returns null if it was. forRect is used by rectangular
  // selections, and tries to estimate a character position even for
  // coordinates beyond the right of the text.
  function posFromMouse(cm, e, liberal, forRect) {
    var display = cm.display;
    if (!liberal && e_target(e).getAttribute("cm-not-content") == "true") return null;

    var x, y, space = display.lineSpace.getBoundingClientRect();
    // Fails unpredictably on IE[67] when mouse is dragged around quickly.
    try { x = e.clientX - space.left; y = e.clientY - space.top; }
    catch (e) { return null; }
    var coords = coordsChar(cm, x, y), line;
    if (forRect && coords.xRel == 1 && (line = getLine(cm.doc, coords.line).text).length == coords.ch) {
      var colDiff = countColumn(line, line.length, cm.options.tabSize) - line.length;
      coords = Pos(coords.line, Math.max(0, Math.round((x - paddingH(cm.display).left) / charWidth(cm.display)) - colDiff));
    }
    return coords;
  }

  // A mouse down can be a single click, double click, triple click,
  // start of selection drag, start of text drag, new cursor
  // (ctrl-click), rectangle drag (alt-drag), or xwin
  // middle-click-paste. Or it might be a click on something we should
  // not interfere with, such as a scrollbar or widget.
  function onMouseDown(e) {
    var cm = this, display = cm.display;
    if (display.activeTouch && display.input.supportsTouch() || signalDOMEvent(cm, e)) return;
    display.shift = e.shiftKey;

    if (eventInWidget(display, e)) {
      if (!webkit) {
        // Briefly turn off draggability, to allow widgets to do
        // normal dragging things.
        display.scroller.draggable = false;
        setTimeout(function(){display.scroller.draggable = true;}, 100);
      }
      return;
    }
    if (clickInGutter(cm, e)) return;
    var start = posFromMouse(cm, e);
    window.focus();

    switch (e_button(e)) {
    case 1:
      // #3261: make sure, that we're not starting a second selection
      if (cm.state.selectingText)
        cm.state.selectingText(e);
      else if (start)
        leftButtonDown(cm, e, start);
      else if (e_target(e) == display.scroller)
        e_preventDefault(e);
      break;
    case 2:
      if (webkit) cm.state.lastMiddleDown = +new Date;
      if (start) extendSelection(cm.doc, start);
      setTimeout(function() {display.input.focus();}, 20);
      e_preventDefault(e);
      break;
    case 3:
      if (captureRightClick) onContextMenu(cm, e);
      else delayBlurEvent(cm);
      break;
    }
  }

  var lastClick, lastDoubleClick;
  function leftButtonDown(cm, e, start) {
    if (ie) setTimeout(bind(ensureFocus, cm), 0);
    else cm.curOp.focus = activeElt();

    var now = +new Date, type;
    if (lastDoubleClick && lastDoubleClick.time > now - 400 && cmp(lastDoubleClick.pos, start) == 0) {
      type = "triple";
    } else if (lastClick && lastClick.time > now - 400 && cmp(lastClick.pos, start) == 0) {
      type = "double";
      lastDoubleClick = {time: now, pos: start};
    } else {
      type = "single";
      lastClick = {time: now, pos: start};
    }

    var sel = cm.doc.sel, modifier = mac ? e.metaKey : e.ctrlKey, contained;
    if (cm.options.dragDrop && dragAndDrop && !isReadOnly(cm) &&
        type == "single" && (contained = sel.contains(start)) > -1 &&
        (cmp((contained = sel.ranges[contained]).from(), start) < 0 || start.xRel > 0) &&
        (cmp(contained.to(), start) > 0 || start.xRel < 0))
      leftButtonStartDrag(cm, e, start, modifier);
    else
      leftButtonSelect(cm, e, start, type, modifier);
  }

  // Start a text drag. When it ends, see if any dragging actually
  // happen, and treat as a click if it didn't.
  function leftButtonStartDrag(cm, e, start, modifier) {
    var display = cm.display, startTime = +new Date;
    var dragEnd = operation(cm, function(e2) {
      if (webkit) display.scroller.draggable = false;
      cm.state.draggingText = false;
      off(document, "mouseup", dragEnd);
      off(display.scroller, "drop", dragEnd);
      if (Math.abs(e.clientX - e2.clientX) + Math.abs(e.clientY - e2.clientY) < 10) {
        e_preventDefault(e2);
        if (!modifier && +new Date - 200 < startTime)
          extendSelection(cm.doc, start);
        // Work around unexplainable focus problem in IE9 (#2127) and Chrome (#3081)
        if (webkit || ie && ie_version == 9)
          setTimeout(function() {document.body.focus(); display.input.focus();}, 20);
        else
          display.input.focus();
      }
    });
    // Let the drag handler handle this.
    if (webkit) display.scroller.draggable = true;
    cm.state.draggingText = dragEnd;
    // IE's approach to draggable
    if (display.scroller.dragDrop) display.scroller.dragDrop();
    on(document, "mouseup", dragEnd);
    on(display.scroller, "drop", dragEnd);
  }

  // Normal selection, as opposed to text dragging.
  function leftButtonSelect(cm, e, start, type, addNew) {
    var display = cm.display, doc = cm.doc;
    e_preventDefault(e);

    var ourRange, ourIndex, startSel = doc.sel, ranges = startSel.ranges;
    if (addNew && !e.shiftKey) {
      ourIndex = doc.sel.contains(start);
      if (ourIndex > -1)
        ourRange = ranges[ourIndex];
      else
        ourRange = new Range(start, start);
    } else {
      ourRange = doc.sel.primary();
      ourIndex = doc.sel.primIndex;
    }

    if (e.altKey) {
      type = "rect";
      if (!addNew) ourRange = new Range(start, start);
      start = posFromMouse(cm, e, true, true);
      ourIndex = -1;
    } else if (type == "double") {
      var word = cm.findWordAt(start);
      if (cm.display.shift || doc.extend)
        ourRange = extendRange(doc, ourRange, word.anchor, word.head);
      else
        ourRange = word;
    } else if (type == "triple") {
      var line = new Range(Pos(start.line, 0), clipPos(doc, Pos(start.line + 1, 0)));
      if (cm.display.shift || doc.extend)
        ourRange = extendRange(doc, ourRange, line.anchor, line.head);
      else
        ourRange = line;
    } else {
      ourRange = extendRange(doc, ourRange, start);
    }

    if (!addNew) {
      ourIndex = 0;
      setSelection(doc, new Selection([ourRange], 0), sel_mouse);
      startSel = doc.sel;
    } else if (ourIndex == -1) {
      ourIndex = ranges.length;
      setSelection(doc, normalizeSelection(ranges.concat([ourRange]), ourIndex),
                   {scroll: false, origin: "*mouse"});
    } else if (ranges.length > 1 && ranges[ourIndex].empty() && type == "single" && !e.shiftKey) {
      setSelection(doc, normalizeSelection(ranges.slice(0, ourIndex).concat(ranges.slice(ourIndex + 1)), 0),
                   {scroll: false, origin: "*mouse"});
      startSel = doc.sel;
    } else {
      replaceOneSelection(doc, ourIndex, ourRange, sel_mouse);
    }

    var lastPos = start;
    function extendTo(pos) {
      if (cmp(lastPos, pos) == 0) return;
      lastPos = pos;

      if (type == "rect") {
        var ranges = [], tabSize = cm.options.tabSize;
        var startCol = countColumn(getLine(doc, start.line).text, start.ch, tabSize);
        var posCol = countColumn(getLine(doc, pos.line).text, pos.ch, tabSize);
        var left = Math.min(startCol, posCol), right = Math.max(startCol, posCol);
        for (var line = Math.min(start.line, pos.line), end = Math.min(cm.lastLine(), Math.max(start.line, pos.line));
             line <= end; line++) {
          var text = getLine(doc, line).text, leftPos = findColumn(text, left, tabSize);
          if (left == right)
            ranges.push(new Range(Pos(line, leftPos), Pos(line, leftPos)));
          else if (text.length > leftPos)
            ranges.push(new Range(Pos(line, leftPos), Pos(line, findColumn(text, right, tabSize))));
        }
        if (!ranges.length) ranges.push(new Range(start, start));
        setSelection(doc, normalizeSelection(startSel.ranges.slice(0, ourIndex).concat(ranges), ourIndex),
                     {origin: "*mouse", scroll: false});
        cm.scrollIntoView(pos);
      } else {
        var oldRange = ourRange;
        var anchor = oldRange.anchor, head = pos;
        if (type != "single") {
          if (type == "double")
            var range = cm.findWordAt(pos);
          else
            var range = new Range(Pos(pos.line, 0), clipPos(doc, Pos(pos.line + 1, 0)));
          if (cmp(range.anchor, anchor) > 0) {
            head = range.head;
            anchor = minPos(oldRange.from(), range.anchor);
          } else {
            head = range.anchor;
            anchor = maxPos(oldRange.to(), range.head);
          }
        }
        var ranges = startSel.ranges.slice(0);
        ranges[ourIndex] = new Range(clipPos(doc, anchor), head);
        setSelection(doc, normalizeSelection(ranges, ourIndex), sel_mouse);
      }
    }

    var editorSize = display.wrapper.getBoundingClientRect();
    // Used to ensure timeout re-tries don't fire when another extend
    // happened in the meantime (clearTimeout isn't reliable -- at
    // least on Chrome, the timeouts still happen even when cleared,
    // if the clear happens after their scheduled firing time).
    var counter = 0;

    function extend(e) {
      var curCount = ++counter;
      var cur = posFromMouse(cm, e, true, type == "rect");
      if (!cur) return;
      if (cmp(cur, lastPos) != 0) {
        cm.curOp.focus = activeElt();
        extendTo(cur);
        var visible = visibleLines(display, doc);
        if (cur.line >= visible.to || cur.line < visible.from)
          setTimeout(operation(cm, function(){if (counter == curCount) extend(e);}), 150);
      } else {
        var outside = e.clientY < editorSize.top ? -20 : e.clientY > editorSize.bottom ? 20 : 0;
        if (outside) setTimeout(operation(cm, function() {
          if (counter != curCount) return;
          display.scroller.scrollTop += outside;
          extend(e);
        }), 50);
      }
    }

    function done(e) {
      cm.state.selectingText = false;
      counter = Infinity;
      e_preventDefault(e);
      display.input.focus();
      off(document, "mousemove", move);
      off(document, "mouseup", up);
      doc.history.lastSelOrigin = null;
    }

    var move = operation(cm, function(e) {
      if (!e_button(e)) done(e);
      else extend(e);
    });
    var up = operation(cm, done);
    cm.state.selectingText = up;
    on(document, "mousemove", move);
    on(document, "mouseup", up);
  }

  // Determines whether an event happened in the gutter, and fires the
  // handlers for the corresponding event.
  function gutterEvent(cm, e, type, prevent, signalfn) {
    try { var mX = e.clientX, mY = e.clientY; }
    catch(e) { return false; }
    if (mX >= Math.floor(cm.display.gutters.getBoundingClientRect().right)) return false;
    if (prevent) e_preventDefault(e);

    var display = cm.display;
    var lineBox = display.lineDiv.getBoundingClientRect();

    if (mY > lineBox.bottom || !hasHandler(cm, type)) return e_defaultPrevented(e);
    mY -= lineBox.top - display.viewOffset;

    for (var i = 0; i < cm.options.gutters.length; ++i) {
      var g = display.gutters.childNodes[i];
      if (g && g.getBoundingClientRect().right >= mX) {
        var line = lineAtHeight(cm.doc, mY);
        var gutter = cm.options.gutters[i];
        signalfn(cm, type, cm, line, gutter, e);
        return e_defaultPrevented(e);
      }
    }
  }

  function clickInGutter(cm, e) {
    return gutterEvent(cm, e, "gutterClick", true, signalLater);
  }

  // Kludge to work around strange IE behavior where it'll sometimes
  // re-fire a series of drag-related events right after the drop (#1551)
  var lastDrop = 0;

  function onDrop(e) {
    var cm = this;
    clearDragCursor(cm);
    if (signalDOMEvent(cm, e) || eventInWidget(cm.display, e))
      return;
    e_preventDefault(e);
    if (ie) lastDrop = +new Date;
    var pos = posFromMouse(cm, e, true), files = e.dataTransfer.files;
    if (!pos || isReadOnly(cm)) return;
    // Might be a file drop, in which case we simply extract the text
    // and insert it.
    if (files && files.length && window.FileReader && window.File) {
      var n = files.length, text = Array(n), read = 0;
      var loadFile = function(file, i) {
        if (cm.options.allowDropFileTypes &&
            indexOf(cm.options.allowDropFileTypes, file.type) == -1)
          return;

        var reader = new FileReader;
        reader.onload = operation(cm, function() {
          var content = reader.result;
          if (/[\x00-\x08\x0e-\x1f]{2}/.test(content)) content = "";
          text[i] = content;
          if (++read == n) {
            pos = clipPos(cm.doc, pos);
            var change = {from: pos, to: pos,
                          text: cm.doc.splitLines(text.join(cm.doc.lineSeparator())),
                          origin: "paste"};
            makeChange(cm.doc, change);
            setSelectionReplaceHistory(cm.doc, simpleSelection(pos, changeEnd(change)));
          }
        });
        reader.readAsText(file);
      };
      for (var i = 0; i < n; ++i) loadFile(files[i], i);
    } else { // Normal drop
      // Don't do a replace if the drop happened inside of the selected text.
      if (cm.state.draggingText && cm.doc.sel.contains(pos) > -1) {
        cm.state.draggingText(e);
        // Ensure the editor is re-focused
        setTimeout(function() {cm.display.input.focus();}, 20);
        return;
      }
      try {
        var text = e.dataTransfer.getData("Text");
        if (text) {
          if (cm.state.draggingText && !(mac ? e.altKey : e.ctrlKey))
            var selected = cm.listSelections();
          setSelectionNoUndo(cm.doc, simpleSelection(pos, pos));
          if (selected) for (var i = 0; i < selected.length; ++i)
            replaceRange(cm.doc, "", selected[i].anchor, selected[i].head, "drag");
          cm.replaceSelection(text, "around", "paste");
          cm.display.input.focus();
        }
      }
      catch(e){}
    }
  }

  function onDragStart(cm, e) {
    if (ie && (!cm.state.draggingText || +new Date - lastDrop < 100)) { e_stop(e); return; }
    if (signalDOMEvent(cm, e) || eventInWidget(cm.display, e)) return;

    e.dataTransfer.setData("Text", cm.getSelection());

    // Use dummy image instead of default browsers image.
    // Recent Safari (~6.0.2) have a tendency to segfault when this happens, so we don't do it there.
    if (e.dataTransfer.setDragImage && !safari) {
      var img = elt("img", null, null, "position: fixed; left: 0; top: 0;");
      img.src = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
      if (presto) {
        img.width = img.height = 1;
        cm.display.wrapper.appendChild(img);
        // Force a relayout, or Opera won't use our image for some obscure reason
        img._top = img.offsetTop;
      }
      e.dataTransfer.setDragImage(img, 0, 0);
      if (presto) img.parentNode.removeChild(img);
    }
  }

  function onDragOver(cm, e) {
    var pos = posFromMouse(cm, e);
    if (!pos) return;
    var frag = document.createDocumentFragment();
    drawSelectionCursor(cm, pos, frag);
    if (!cm.display.dragCursor) {
      cm.display.dragCursor = elt("div", null, "CodeMirror-cursors CodeMirror-dragcursors");
      cm.display.lineSpace.insertBefore(cm.display.dragCursor, cm.display.cursorDiv);
    }
    removeChildrenAndAdd(cm.display.dragCursor, frag);
  }

  function clearDragCursor(cm) {
    if (cm.display.dragCursor) {
      cm.display.lineSpace.removeChild(cm.display.dragCursor);
      cm.display.dragCursor = null;
    }
  }

  // SCROLL EVENTS

  // Sync the scrollable area and scrollbars, ensure the viewport
  // covers the visible area.
  function setScrollTop(cm, val) {
    if (Math.abs(cm.doc.scrollTop - val) < 2) return;
    cm.doc.scrollTop = val;
    if (!gecko) updateDisplaySimple(cm, {top: val});
    if (cm.display.scroller.scrollTop != val) cm.display.scroller.scrollTop = val;
    cm.display.scrollbars.setScrollTop(val);
    if (gecko) updateDisplaySimple(cm);
    startWorker(cm, 100);
  }
  // Sync scroller and scrollbar, ensure the gutter elements are
  // aligned.
  function setScrollLeft(cm, val, isScroller) {
    if (isScroller ? val == cm.doc.scrollLeft : Math.abs(cm.doc.scrollLeft - val) < 2) return;
    val = Math.min(val, cm.display.scroller.scrollWidth - cm.display.scroller.clientWidth);
    cm.doc.scrollLeft = val;
    alignHorizontally(cm);
    if (cm.display.scroller.scrollLeft != val) cm.display.scroller.scrollLeft = val;
    cm.display.scrollbars.setScrollLeft(val);
  }

  // Since the delta values reported on mouse wheel events are
  // unstandardized between browsers and even browser versions, and
  // generally horribly unpredictable, this code starts by measuring
  // the scroll effect that the first few mouse wheel events have,
  // and, from that, detects the way it can convert deltas to pixel
  // offsets afterwards.
  //
  // The reason we want to know the amount a wheel event will scroll
  // is that it gives us a chance to update the display before the
  // actual scrolling happens, reducing flickering.

  var wheelSamples = 0, wheelPixelsPerUnit = null;
  // Fill in a browser-detected starting value on browsers where we
  // know one. These don't have to be accurate -- the result of them
  // being wrong would just be a slight flicker on the first wheel
  // scroll (if it is large enough).
  if (ie) wheelPixelsPerUnit = -.53;
  else if (gecko) wheelPixelsPerUnit = 15;
  else if (chrome) wheelPixelsPerUnit = -.7;
  else if (safari) wheelPixelsPerUnit = -1/3;

  var wheelEventDelta = function(e) {
    var dx = e.wheelDeltaX, dy = e.wheelDeltaY;
    if (dx == null && e.detail && e.axis == e.HORIZONTAL_AXIS) dx = e.detail;
    if (dy == null && e.detail && e.axis == e.VERTICAL_AXIS) dy = e.detail;
    else if (dy == null) dy = e.wheelDelta;
    return {x: dx, y: dy};
  };
  CodeMirror.wheelEventPixels = function(e) {
    var delta = wheelEventDelta(e);
    delta.x *= wheelPixelsPerUnit;
    delta.y *= wheelPixelsPerUnit;
    return delta;
  };

  function onScrollWheel(cm, e) {
    var delta = wheelEventDelta(e), dx = delta.x, dy = delta.y;

    var display = cm.display, scroll = display.scroller;
    // Quit if there's nothing to scroll here
    var canScrollX = scroll.scrollWidth > scroll.clientWidth;
    var canScrollY = scroll.scrollHeight > scroll.clientHeight;
    if (!(dx && canScrollX || dy && canScrollY)) return;

    // Webkit browsers on OS X abort momentum scrolls when the target
    // of the scroll event is removed from the scrollable element.
    // This hack (see related code in patchDisplay) makes sure the
    // element is kept around.
    if (dy && mac && webkit) {
      outer: for (var cur = e.target, view = display.view; cur != scroll; cur = cur.parentNode) {
        for (var i = 0; i < view.length; i++) {
          if (view[i].node == cur) {
            cm.display.currentWheelTarget = cur;
            break outer;
          }
        }
      }
    }

    // On some browsers, horizontal scrolling will cause redraws to
    // happen before the gutter has been realigned, causing it to
    // wriggle around in a most unseemly way. When we have an
    // estimated pixels/delta value, we just handle horizontal
    // scrolling entirely here. It'll be slightly off from native, but
    // better than glitching out.
    if (dx && !gecko && !presto && wheelPixelsPerUnit != null) {
      if (dy && canScrollY)
        setScrollTop(cm, Math.max(0, Math.min(scroll.scrollTop + dy * wheelPixelsPerUnit, scroll.scrollHeight - scroll.clientHeight)));
      setScrollLeft(cm, Math.max(0, Math.min(scroll.scrollLeft + dx * wheelPixelsPerUnit, scroll.scrollWidth - scroll.clientWidth)));
      // Only prevent default scrolling if vertical scrolling is
      // actually possible. Otherwise, it causes vertical scroll
      // jitter on OSX trackpads when deltaX is small and deltaY
      // is large (issue #3579)
      if (!dy || (dy && canScrollY))
        e_preventDefault(e);
      display.wheelStartX = null; // Abort measurement, if in progress
      return;
    }

    // 'Project' the visible viewport to cover the area that is being
    // scrolled into view (if we know enough to estimate it).
    if (dy && wheelPixelsPerUnit != null) {
      var pixels = dy * wheelPixelsPerUnit;
      var top = cm.doc.scrollTop, bot = top + display.wrapper.clientHeight;
      if (pixels < 0) top = Math.max(0, top + pixels - 50);
      else bot = Math.min(cm.doc.height, bot + pixels + 50);
      updateDisplaySimple(cm, {top: top, bottom: bot});
    }

    if (wheelSamples < 20) {
      if (display.wheelStartX == null) {
        display.wheelStartX = scroll.scrollLeft; display.wheelStartY = scroll.scrollTop;
        display.wheelDX = dx; display.wheelDY = dy;
        setTimeout(function() {
          if (display.wheelStartX == null) return;
          var movedX = scroll.scrollLeft - display.wheelStartX;
          var movedY = scroll.scrollTop - display.wheelStartY;
          var sample = (movedY && display.wheelDY && movedY / display.wheelDY) ||
            (movedX && display.wheelDX && movedX / display.wheelDX);
          display.wheelStartX = display.wheelStartY = null;
          if (!sample) return;
          wheelPixelsPerUnit = (wheelPixelsPerUnit * wheelSamples + sample) / (wheelSamples + 1);
          ++wheelSamples;
        }, 200);
      } else {
        display.wheelDX += dx; display.wheelDY += dy;
      }
    }
  }

  // KEY EVENTS

  // Run a handler that was bound to a key.
  function doHandleBinding(cm, bound, dropShift) {
    if (typeof bound == "string") {
      bound = commands[bound];
      if (!bound) return false;
    }
    // Ensure previous input has been read, so that the handler sees a
    // consistent view of the document
    cm.display.input.ensurePolled();
    var prevShift = cm.display.shift, done = false;
    try {
      if (isReadOnly(cm)) cm.state.suppressEdits = true;
      if (dropShift) cm.display.shift = false;
      done = bound(cm) != Pass;
    } finally {
      cm.display.shift = prevShift;
      cm.state.suppressEdits = false;
    }
    return done;
  }

  function lookupKeyForEditor(cm, name, handle) {
    for (var i = 0; i < cm.state.keyMaps.length; i++) {
      var result = lookupKey(name, cm.state.keyMaps[i], handle, cm);
      if (result) return result;
    }
    return (cm.options.extraKeys && lookupKey(name, cm.options.extraKeys, handle, cm))
      || lookupKey(name, cm.options.keyMap, handle, cm);
  }

  var stopSeq = new Delayed;
  function dispatchKey(cm, name, e, handle) {
    var seq = cm.state.keySeq;
    if (seq) {
      if (isModifierKey(name)) return "handled";
      stopSeq.set(50, function() {
        if (cm.state.keySeq == seq) {
          cm.state.keySeq = null;
          cm.display.input.reset();
        }
      });
      name = seq + " " + name;
    }
    var result = lookupKeyForEditor(cm, name, handle);

    if (result == "multi")
      cm.state.keySeq = name;
    if (result == "handled")
      signalLater(cm, "keyHandled", cm, name, e);

    if (result == "handled" || result == "multi") {
      e_preventDefault(e);
      restartBlink(cm);
    }

    if (seq && !result && /\'$/.test(name)) {
      e_preventDefault(e);
      return true;
    }
    return !!result;
  }

  // Handle a key from the keydown event.
  function handleKeyBinding(cm, e) {
    var name = keyName(e, true);
    if (!name) return false;

    if (e.shiftKey && !cm.state.keySeq) {
      // First try to resolve full name (including 'Shift-'). Failing
      // that, see if there is a cursor-motion command (starting with
      // 'go') bound to the keyname without 'Shift-'.
      return dispatchKey(cm, "Shift-" + name, e, function(b) {return doHandleBinding(cm, b, true);})
          || dispatchKey(cm, name, e, function(b) {
               if (typeof b == "string" ? /^go[A-Z]/.test(b) : b.motion)
                 return doHandleBinding(cm, b);
             });
    } else {
      return dispatchKey(cm, name, e, function(b) { return doHandleBinding(cm, b); });
    }
  }

  // Handle a key from the keypress event
  function handleCharBinding(cm, e, ch) {
    return dispatchKey(cm, "'" + ch + "'", e,
                       function(b) { return doHandleBinding(cm, b, true); });
  }

  var lastStoppedKey = null;
  function onKeyDown(e) {
    var cm = this;
    cm.curOp.focus = activeElt();
    if (signalDOMEvent(cm, e)) return;
    // IE does strange things with escape.
    if (ie && ie_version < 11 && e.keyCode == 27) e.returnValue = false;
    var code = e.keyCode;
    cm.display.shift = code == 16 || e.shiftKey;
    var handled = handleKeyBinding(cm, e);
    if (presto) {
      lastStoppedKey = handled ? code : null;
      // Opera has no cut event... we try to at least catch the key combo
      if (!handled && code == 88 && !hasCopyEvent && (mac ? e.metaKey : e.ctrlKey))
        cm.replaceSelection("", null, "cut");
    }

    // Turn mouse into crosshair when Alt is held on Mac.
    if (code == 18 && !/\bCodeMirror-crosshair\b/.test(cm.display.lineDiv.className))
      showCrossHair(cm);
  }

  function showCrossHair(cm) {
    var lineDiv = cm.display.lineDiv;
    addClass(lineDiv, "CodeMirror-crosshair");

    function up(e) {
      if (e.keyCode == 18 || !e.altKey) {
        rmClass(lineDiv, "CodeMirror-crosshair");
        off(document, "keyup", up);
        off(document, "mouseover", up);
      }
    }
    on(document, "keyup", up);
    on(document, "mouseover", up);
  }

  function onKeyUp(e) {
    if (e.keyCode == 16) this.doc.sel.shift = false;
    signalDOMEvent(this, e);
  }

  function onKeyPress(e) {
    var cm = this;
    if (eventInWidget(cm.display, e) || signalDOMEvent(cm, e) || e.ctrlKey && !e.altKey || mac && e.metaKey) return;
    var keyCode = e.keyCode, charCode = e.charCode;
    if (presto && keyCode == lastStoppedKey) {lastStoppedKey = null; e_preventDefault(e); return;}
    if ((presto && (!e.which || e.which < 10)) && handleKeyBinding(cm, e)) return;
    var ch = String.fromCharCode(charCode == null ? keyCode : charCode);
    if (handleCharBinding(cm, e, ch)) return;
    cm.display.input.onKeyPress(e);
  }

  // FOCUS/BLUR EVENTS

  function delayBlurEvent(cm) {
    cm.state.delayingBlurEvent = true;
    setTimeout(function() {
      if (cm.state.delayingBlurEvent) {
        cm.state.delayingBlurEvent = false;
        onBlur(cm);
      }
    }, 100);
  }

  function onFocus(cm) {
    if (cm.state.delayingBlurEvent) cm.state.delayingBlurEvent = false;

    if (cm.options.readOnly == "nocursor") return;
    if (!cm.state.focused) {
      signal(cm, "focus", cm);
      cm.state.focused = true;
      addClass(cm.display.wrapper, "CodeMirror-focused");
      // This test prevents this from firing when a context
      // menu is closed (since the input reset would kill the
      // select-all detection hack)
      if (!cm.curOp && cm.display.selForContextMenu != cm.doc.sel) {
        cm.display.input.reset();
        if (webkit) setTimeout(function() { cm.display.input.reset(true); }, 20); // Issue #1730
      }
      cm.display.input.receivedFocus();
    }
    restartBlink(cm);
  }
  function onBlur(cm) {
    if (cm.state.delayingBlurEvent) return;

    if (cm.state.focused) {
      signal(cm, "blur", cm);
      cm.state.focused = false;
      rmClass(cm.display.wrapper, "CodeMirror-focused");
    }
    clearInterval(cm.display.blinker);
    setTimeout(function() {if (!cm.state.focused) cm.display.shift = false;}, 150);
  }

  // CONTEXT MENU HANDLING

  // To make the context menu work, we need to briefly unhide the
  // textarea (making it as unobtrusive as possible) to let the
  // right-click take effect on it.
  function onContextMenu(cm, e) {
    if (eventInWidget(cm.display, e) || contextMenuInGutter(cm, e)) return;
    if (signalDOMEvent(cm, e, "contextmenu")) return;
    cm.display.input.onContextMenu(e);
  }

  function contextMenuInGutter(cm, e) {
    if (!hasHandler(cm, "gutterContextMenu")) return false;
    return gutterEvent(cm, e, "gutterContextMenu", false, signal);
  }

  // UPDATING

  // Compute the position of the end of a change (its 'to' property
  // refers to the pre-change end).
  var changeEnd = CodeMirror.changeEnd = function(change) {
    if (!change.text) return change.to;
    return Pos(change.from.line + change.text.length - 1,
               lst(change.text).length + (change.text.length == 1 ? change.from.ch : 0));
  };

  // Adjust a position to refer to the post-change position of the
  // same text, or the end of the change if the change covers it.
  function adjustForChange(pos, change) {
    if (cmp(pos, change.from) < 0) return pos;
    if (cmp(pos, change.to) <= 0) return changeEnd(change);

    var line = pos.line + change.text.length - (change.to.line - change.from.line) - 1, ch = pos.ch;
    if (pos.line == change.to.line) ch += changeEnd(change).ch - change.to.ch;
    return Pos(line, ch);
  }

  function computeSelAfterChange(doc, change) {
    var out = [];
    for (var i = 0; i < doc.sel.ranges.length; i++) {
      var range = doc.sel.ranges[i];
      out.push(new Range(adjustForChange(range.anchor, change),
                         adjustForChange(range.head, change)));
    }
    return normalizeSelection(out, doc.sel.primIndex);
  }

  function offsetPos(pos, old, nw) {
    if (pos.line == old.line)
      return Pos(nw.line, pos.ch - old.ch + nw.ch);
    else
      return Pos(nw.line + (pos.line - old.line), pos.ch);
  }

  // Used by replaceSelections to allow moving the selection to the
  // start or around the replaced test. Hint may be "start" or "around".
  function computeReplacedSel(doc, changes, hint) {
    var out = [];
    var oldPrev = Pos(doc.first, 0), newPrev = oldPrev;
    for (var i = 0; i < changes.length; i++) {
      var change = changes[i];
      var from = offsetPos(change.from, oldPrev, newPrev);
      var to = offsetPos(changeEnd(change), oldPrev, newPrev);
      oldPrev = change.to;
      newPrev = to;
      if (hint == "around") {
        var range = doc.sel.ranges[i], inv = cmp(range.head, range.anchor) < 0;
        out[i] = new Range(inv ? to : from, inv ? from : to);
      } else {
        out[i] = new Range(from, from);
      }
    }
    return new Selection(out, doc.sel.primIndex);
  }

  // Allow "beforeChange" event handlers to influence a change
  function filterChange(doc, change, update) {
    var obj = {
      canceled: false,
      from: change.from,
      to: change.to,
      text: change.text,
      origin: change.origin,
      cancel: function() { this.canceled = true; }
    };
    if (update) obj.update = function(from, to, text, origin) {
      if (from) this.from = clipPos(doc, from);
      if (to) this.to = clipPos(doc, to);
      if (text) this.text = text;
      if (origin !== undefined) this.origin = origin;
    };
    signal(doc, "beforeChange", doc, obj);
    if (doc.cm) signal(doc.cm, "beforeChange", doc.cm, obj);

    if (obj.canceled) return null;
    return {from: obj.from, to: obj.to, text: obj.text, origin: obj.origin};
  }

  // Apply a change to a document, and add it to the document's
  // history, and propagating it to all linked documents.
  function makeChange(doc, change, ignoreReadOnly) {
    if (doc.cm) {
      if (!doc.cm.curOp) return operation(doc.cm, makeChange)(doc, change, ignoreReadOnly);
      if (doc.cm.state.suppressEdits) return;
    }

    if (hasHandler(doc, "beforeChange") || doc.cm && hasHandler(doc.cm, "beforeChange")) {
      change = filterChange(doc, change, true);
      if (!change) return;
    }

    // Possibly split or suppress the update based on the presence
    // of read-only spans in its range.
    var split = sawReadOnlySpans && !ignoreReadOnly && removeReadOnlyRanges(doc, change.from, change.to);
    if (split) {
      for (var i = split.length - 1; i >= 0; --i)
        makeChangeInner(doc, {from: split[i].from, to: split[i].to, text: i ? [""] : change.text});
    } else {
      makeChangeInner(doc, change);
    }
  }

  function makeChangeInner(doc, change) {
    if (change.text.length == 1 && change.text[0] == "" && cmp(change.from, change.to) == 0) return;
    var selAfter = computeSelAfterChange(doc, change);
    addChangeToHistory(doc, change, selAfter, doc.cm ? doc.cm.curOp.id : NaN);

    makeChangeSingleDoc(doc, change, selAfter, stretchSpansOverChange(doc, change));
    var rebased = [];

    linkedDocs(doc, function(doc, sharedHist) {
      if (!sharedHist && indexOf(rebased, doc.history) == -1) {
        rebaseHist(doc.history, change);
        rebased.push(doc.history);
      }
      makeChangeSingleDoc(doc, change, null, stretchSpansOverChange(doc, change));
    });
  }

  // Revert a change stored in a document's history.
  function makeChangeFromHistory(doc, type, allowSelectionOnly) {
    if (doc.cm && doc.cm.state.suppressEdits) return;

    var hist = doc.history, event, selAfter = doc.sel;
    var source = type == "undo" ? hist.done : hist.undone, dest = type == "undo" ? hist.undone : hist.done;

    // Verify that there is a useable event (so that ctrl-z won't
    // needlessly clear selection events)
    for (var i = 0; i < source.length; i++) {
      event = source[i];
      if (allowSelectionOnly ? event.ranges && !event.equals(doc.sel) : !event.ranges)
        break;
    }
    if (i == source.length) return;
    hist.lastOrigin = hist.lastSelOrigin = null;

    for (;;) {
      event = source.pop();
      if (event.ranges) {
        pushSelectionToHistory(event, dest);
        if (allowSelectionOnly && !event.equals(doc.sel)) {
          setSelection(doc, event, {clearRedo: false});
          return;
        }
        selAfter = event;
      }
      else break;
    }

    // Build up a reverse change object to add to the opposite history
    // stack (redo when undoing, and vice versa).
    var antiChanges = [];
    pushSelectionToHistory(selAfter, dest);
    dest.push({changes: antiChanges, generation: hist.generation});
    hist.generation = event.generation || ++hist.maxGeneration;

    var filter = hasHandler(doc, "beforeChange") || doc.cm && hasHandler(doc.cm, "beforeChange");

    for (var i = event.changes.length - 1; i >= 0; --i) {
      var change = event.changes[i];
      change.origin = type;
      if (filter && !filterChange(doc, change, false)) {
        source.length = 0;
        return;
      }

      antiChanges.push(historyChangeFromChange(doc, change));

      var after = i ? computeSelAfterChange(doc, change) : lst(source);
      makeChangeSingleDoc(doc, change, after, mergeOldSpans(doc, change));
      if (!i && doc.cm) doc.cm.scrollIntoView({from: change.from, to: changeEnd(change)});
      var rebased = [];

      // Propagate to the linked documents
      linkedDocs(doc, function(doc, sharedHist) {
        if (!sharedHist && indexOf(rebased, doc.history) == -1) {
          rebaseHist(doc.history, change);
          rebased.push(doc.history);
        }
        makeChangeSingleDoc(doc, change, null, mergeOldSpans(doc, change));
      });
    }
  }

  // Sub-views need their line numbers shifted when text is added
  // above or below them in the parent document.
  function shiftDoc(doc, distance) {
    if (distance == 0) return;
    doc.first += distance;
    doc.sel = new Selection(map(doc.sel.ranges, function(range) {
      return new Range(Pos(range.anchor.line + distance, range.anchor.ch),
                       Pos(range.head.line + distance, range.head.ch));
    }), doc.sel.primIndex);
    if (doc.cm) {
      regChange(doc.cm, doc.first, doc.first - distance, distance);
      for (var d = doc.cm.display, l = d.viewFrom; l < d.viewTo; l++)
        regLineChange(doc.cm, l, "gutter");
    }
  }

  // More lower-level change function, handling only a single document
  // (not linked ones).
  function makeChangeSingleDoc(doc, change, selAfter, spans) {
    if (doc.cm && !doc.cm.curOp)
      return operation(doc.cm, makeChangeSingleDoc)(doc, change, selAfter, spans);

    if (change.to.line < doc.first) {
      shiftDoc(doc, change.text.length - 1 - (change.to.line - change.from.line));
      return;
    }
    if (change.from.line > doc.lastLine()) return;

    // Clip the change to the size of this doc
    if (change.from.line < doc.first) {
      var shift = change.text.length - 1 - (doc.first - change.from.line);
      shiftDoc(doc, shift);
      change = {from: Pos(doc.first, 0), to: Pos(change.to.line + shift, change.to.ch),
                text: [lst(change.text)], origin: change.origin};
    }
    var last = doc.lastLine();
    if (change.to.line > last) {
      change = {from: change.from, to: Pos(last, getLine(doc, last).text.length),
                text: [change.text[0]], origin: change.origin};
    }

    change.removed = getBetween(doc, change.from, change.to);

    if (!selAfter) selAfter = computeSelAfterChange(doc, change);
    if (doc.cm) makeChangeSingleDocInEditor(doc.cm, change, spans);
    else updateDoc(doc, change, spans);
    setSelectionNoUndo(doc, selAfter, sel_dontScroll);
  }

  // Handle the interaction of a change to a document with the editor
  // that this document is part of.
  function makeChangeSingleDocInEditor(cm, change, spans) {
    var doc = cm.doc, display = cm.display, from = change.from, to = change.to;

    var recomputeMaxLength = false, checkWidthStart = from.line;
    if (!cm.options.lineWrapping) {
      checkWidthStart = lineNo(visualLine(getLine(doc, from.line)));
      doc.iter(checkWidthStart, to.line + 1, function(line) {
        if (line == display.maxLine) {
          recomputeMaxLength = true;
          return true;
        }
      });
    }

    if (doc.sel.contains(change.from, change.to) > -1)
      signalCursorActivity(cm);

    updateDoc(doc, change, spans, estimateHeight(cm));

    if (!cm.options.lineWrapping) {
      doc.iter(checkWidthStart, from.line + change.text.length, function(line) {
        var len = lineLength(line);
        if (len > display.maxLineLength) {
          display.maxLine = line;
          display.maxLineLength = len;
          display.maxLineChanged = true;
          recomputeMaxLength = false;
        }
      });
      if (recomputeMaxLength) cm.curOp.updateMaxLine = true;
    }

    // Adjust frontier, schedule worker
    doc.frontier = Math.min(doc.frontier, from.line);
    startWorker(cm, 400);

    var lendiff = change.text.length - (to.line - from.line) - 1;
    // Remember that these lines changed, for updating the display
    if (change.full)
      regChange(cm);
    else if (from.line == to.line && change.text.length == 1 && !isWholeLineUpdate(cm.doc, change))
      regLineChange(cm, from.line, "text");
    else
      regChange(cm, from.line, to.line + 1, lendiff);

    var changesHandler = hasHandler(cm, "changes"), changeHandler = hasHandler(cm, "change");
    if (changeHandler || changesHandler) {
      var obj = {
        from: from, to: to,
        text: change.text,
        removed: change.removed,
        origin: change.origin
      };
      if (changeHandler) signalLater(cm, "change", cm, obj);
      if (changesHandler) (cm.curOp.changeObjs || (cm.curOp.changeObjs = [])).push(obj);
    }
    cm.display.selForContextMenu = null;
  }

  function replaceRange(doc, code, from, to, origin) {
    if (!to) to = from;
    if (cmp(to, from) < 0) { var tmp = to; to = from; from = tmp; }
    if (typeof code == "string") code = doc.splitLines(code);
    makeChange(doc, {from: from, to: to, text: code, origin: origin});
  }

  // SCROLLING THINGS INTO VIEW

  // If an editor sits on the top or bottom of the window, partially
  // scrolled out of view, this ensures that the cursor is visible.
  function maybeScrollWindow(cm, coords) {
    if (signalDOMEvent(cm, "scrollCursorIntoView")) return;

    var display = cm.display, box = display.sizer.getBoundingClientRect(), doScroll = null;
    if (coords.top + box.top < 0) doScroll = true;
    else if (coords.bottom + box.top > (window.innerHeight || document.documentElement.clientHeight)) doScroll = false;
    if (doScroll != null && !phantom) {
      var scrollNode = elt("div", "\u200b", null, "position: absolute; top: " +
                           (coords.top - display.viewOffset - paddingTop(cm.display)) + "px; height: " +
                           (coords.bottom - coords.top + scrollGap(cm) + display.barHeight) + "px; left: " +
                           coords.left + "px; width: 2px;");
      cm.display.lineSpace.appendChild(scrollNode);
      scrollNode.scrollIntoView(doScroll);
      cm.display.lineSpace.removeChild(scrollNode);
    }
  }

  // Scroll a given position into view (immediately), verifying that
  // it actually became visible (as line heights are accurately
  // measured, the position of something may 'drift' during drawing).
  function scrollPosIntoView(cm, pos, end, margin) {
    if (margin == null) margin = 0;
    for (var limit = 0; limit < 5; limit++) {
      var changed = false, coords = cursorCoords(cm, pos);
      var endCoords = !end || end == pos ? coords : cursorCoords(cm, end);
      var scrollPos = calculateScrollPos(cm, Math.min(coords.left, endCoords.left),
                                         Math.min(coords.top, endCoords.top) - margin,
                                         Math.max(coords.left, endCoords.left),
                                         Math.max(coords.bottom, endCoords.bottom) + margin);
      var startTop = cm.doc.scrollTop, startLeft = cm.doc.scrollLeft;
      if (scrollPos.scrollTop != null) {
        setScrollTop(cm, scrollPos.scrollTop);
        if (Math.abs(cm.doc.scrollTop - startTop) > 1) changed = true;
      }
      if (scrollPos.scrollLeft != null) {
        setScrollLeft(cm, scrollPos.scrollLeft);
        if (Math.abs(cm.doc.scrollLeft - startLeft) > 1) changed = true;
      }
      if (!changed) break;
    }
    return coords;
  }

  // Scroll a given set of coordinates into view (immediately).
  function scrollIntoView(cm, x1, y1, x2, y2) {
    var scrollPos = calculateScrollPos(cm, x1, y1, x2, y2);
    if (scrollPos.scrollTop != null) setScrollTop(cm, scrollPos.scrollTop);
    if (scrollPos.scrollLeft != null) setScrollLeft(cm, scrollPos.scrollLeft);
  }

  // Calculate a new scroll position needed to scroll the given
  // rectangle into view. Returns an object with scrollTop and
  // scrollLeft properties. When these are undefined, the
  // vertical/horizontal position does not need to be adjusted.
  function calculateScrollPos(cm, x1, y1, x2, y2) {
    var display = cm.display, snapMargin = textHeight(cm.display);
    if (y1 < 0) y1 = 0;
    var screentop = cm.curOp && cm.curOp.scrollTop != null ? cm.curOp.scrollTop : display.scroller.scrollTop;
    var screen = displayHeight(cm), result = {};
    if (y2 - y1 > screen) y2 = y1 + screen;
    var docBottom = cm.doc.height + paddingVert(display);
    var atTop = y1 < snapMargin, atBottom = y2 > docBottom - snapMargin;
    if (y1 < screentop) {
      result.scrollTop = atTop ? 0 : y1;
    } else if (y2 > screentop + screen) {
      var newTop = Math.min(y1, (atBottom ? docBottom : y2) - screen);
      if (newTop != screentop) result.scrollTop = newTop;
    }

    var screenleft = cm.curOp && cm.curOp.scrollLeft != null ? cm.curOp.scrollLeft : display.scroller.scrollLeft;
    var screenw = displayWidth(cm) - (cm.options.fixedGutter ? display.gutters.offsetWidth : 0);
    var tooWide = x2 - x1 > screenw;
    if (tooWide) x2 = x1 + screenw;
    if (x1 < 10)
      result.scrollLeft = 0;
    else if (x1 < screenleft)
      result.scrollLeft = Math.max(0, x1 - (tooWide ? 0 : 10));
    else if (x2 > screenw + screenleft - 3)
      result.scrollLeft = x2 + (tooWide ? 0 : 10) - screenw;
    return result;
  }

  // Store a relative adjustment to the scroll position in the current
  // operation (to be applied when the operation finishes).
  function addToScrollPos(cm, left, top) {
    if (left != null || top != null) resolveScrollToPos(cm);
    if (left != null)
      cm.curOp.scrollLeft = (cm.curOp.scrollLeft == null ? cm.doc.scrollLeft : cm.curOp.scrollLeft) + left;
    if (top != null)
      cm.curOp.scrollTop = (cm.curOp.scrollTop == null ? cm.doc.scrollTop : cm.curOp.scrollTop) + top;
  }

  // Make sure that at the end of the operation the current cursor is
  // shown.
  function ensureCursorVisible(cm) {
    resolveScrollToPos(cm);
    var cur = cm.getCursor(), from = cur, to = cur;
    if (!cm.options.lineWrapping) {
      from = cur.ch ? Pos(cur.line, cur.ch - 1) : cur;
      to = Pos(cur.line, cur.ch + 1);
    }
    cm.curOp.scrollToPos = {from: from, to: to, margin: cm.options.cursorScrollMargin, isCursor: true};
  }

  // When an operation has its scrollToPos property set, and another
  // scroll action is applied before the end of the operation, this
  // 'simulates' scrolling that position into view in a cheap way, so
  // that the effect of intermediate scroll commands is not ignored.
  function resolveScrollToPos(cm) {
    var range = cm.curOp.scrollToPos;
    if (range) {
      cm.curOp.scrollToPos = null;
      var from = estimateCoords(cm, range.from), to = estimateCoords(cm, range.to);
      var sPos = calculateScrollPos(cm, Math.min(from.left, to.left),
                                    Math.min(from.top, to.top) - range.margin,
                                    Math.max(from.right, to.right),
                                    Math.max(from.bottom, to.bottom) + range.margin);
      cm.scrollTo(sPos.scrollLeft, sPos.scrollTop);
    }
  }

  // API UTILITIES

  // Indent the given line. The how parameter can be "smart",
  // "add"/null, "subtract", or "prev". When aggressive is false
  // (typically set to true for forced single-line indents), empty
  // lines are not indented, and places where the mode returns Pass
  // are left alone.
  function indentLine(cm, n, how, aggressive) {
    var doc = cm.doc, state;
    if (how == null) how = "add";
    if (how == "smart") {
      // Fall back to "prev" when the mode doesn't have an indentation
      // method.
      if (!doc.mode.indent) how = "prev";
      else state = getStateBefore(cm, n);
    }

    var tabSize = cm.options.tabSize;
    var line = getLine(doc, n), curSpace = countColumn(line.text, null, tabSize);
    if (line.stateAfter) line.stateAfter = null;
    var curSpaceString = line.text.match(/^\s*/)[0], indentation;
    if (!aggressive && !/\S/.test(line.text)) {
      indentation = 0;
      how = "not";
    } else if (how == "smart") {
      indentation = doc.mode.indent(state, line.text.slice(curSpaceString.length), line.text);
      if (indentation == Pass || indentation > 150) {
        if (!aggressive) return;
        how = "prev";
      }
    }
    if (how == "prev") {
      if (n > doc.first) indentation = countColumn(getLine(doc, n-1).text, null, tabSize);
      else indentation = 0;
    } else if (how == "add") {
      indentation = curSpace + cm.options.indentUnit;
    } else if (how == "subtract") {
      indentation = curSpace - cm.options.indentUnit;
    } else if (typeof how == "number") {
      indentation = curSpace + how;
    }
    indentation = Math.max(0, indentation);

    var indentString = "", pos = 0;
    if (cm.options.indentWithTabs)
      for (var i = Math.floor(indentation / tabSize); i; --i) {pos += tabSize; indentString += "\t";}
    if (pos < indentation) indentString += spaceStr(indentation - pos);

    if (indentString != curSpaceString) {
      replaceRange(doc, indentString, Pos(n, 0), Pos(n, curSpaceString.length), "+input");
      line.stateAfter = null;
      return true;
    } else {
      // Ensure that, if the cursor was in the whitespace at the start
      // of the line, it is moved to the end of that space.
      for (var i = 0; i < doc.sel.ranges.length; i++) {
        var range = doc.sel.ranges[i];
        if (range.head.line == n && range.head.ch < curSpaceString.length) {
          var pos = Pos(n, curSpaceString.length);
          replaceOneSelection(doc, i, new Range(pos, pos));
          break;
        }
      }
    }
  }

  // Utility for applying a change to a line by handle or number,
  // returning the number and optionally registering the line as
  // changed.
  function changeLine(doc, handle, changeType, op) {
    var no = handle, line = handle;
    if (typeof handle == "number") line = getLine(doc, clipLine(doc, handle));
    else no = lineNo(handle);
    if (no == null) return null;
    if (op(line, no) && doc.cm) regLineChange(doc.cm, no, changeType);
    return line;
  }

  // Helper for deleting text near the selection(s), used to implement
  // backspace, delete, and similar functionality.
  function deleteNearSelection(cm, compute) {
    var ranges = cm.doc.sel.ranges, kill = [];
    // Build up a set of ranges to kill first, merging overlapping
    // ranges.
    for (var i = 0; i < ranges.length; i++) {
      var toKill = compute(ranges[i]);
      while (kill.length && cmp(toKill.from, lst(kill).to) <= 0) {
        var replaced = kill.pop();
        if (cmp(replaced.from, toKill.from) < 0) {
          toKill.from = replaced.from;
          break;
        }
      }
      kill.push(toKill);
    }
    // Next, remove those actual ranges.
    runInOp(cm, function() {
      for (var i = kill.length - 1; i >= 0; i--)
        replaceRange(cm.doc, "", kill[i].from, kill[i].to, "+delete");
      ensureCursorVisible(cm);
    });
  }

  // Used for horizontal relative motion. Dir is -1 or 1 (left or
  // right), unit can be "char", "column" (like char, but doesn't
  // cross line boundaries), "word" (across next word), or "group" (to
  // the start of next group of word or non-word-non-whitespace
  // chars). The visually param controls whether, in right-to-left
  // text, direction 1 means to move towards the next index in the
  // string, or towards the character to the right of the current
  // position. The resulting position will have a hitSide=true
  // property if it reached the end of the document.
  function findPosH(doc, pos, dir, unit, visually) {
    var line = pos.line, ch = pos.ch, origDir = dir;
    var lineObj = getLine(doc, line);
    var possible = true;
    function findNextLine() {
      var l = line + dir;
      if (l < doc.first || l >= doc.first + doc.size) return (possible = false);
      line = l;
      return lineObj = getLine(doc, l);
    }
    function moveOnce(boundToLine) {
      var next = (visually ? moveVisually : moveLogically)(lineObj, ch, dir, true);
      if (next == null) {
        if (!boundToLine && findNextLine()) {
          if (visually) ch = (dir < 0 ? lineRight : lineLeft)(lineObj);
          else ch = dir < 0 ? lineObj.text.length : 0;
        } else return (possible = false);
      } else ch = next;
      return true;
    }

    if (unit == "char") moveOnce();
    else if (unit == "column") moveOnce(true);
    else if (unit == "word" || unit == "group") {
      var sawType = null, group = unit == "group";
      var helper = doc.cm && doc.cm.getHelper(pos, "wordChars");
      for (var first = true;; first = false) {
        if (dir < 0 && !moveOnce(!first)) break;
        var cur = lineObj.text.charAt(ch) || "\n";
        var type = isWordChar(cur, helper) ? "w"
          : group && cur == "\n" ? "n"
          : !group || /\s/.test(cur) ? null
          : "p";
        if (group && !first && !type) type = "s";
        if (sawType && sawType != type) {
          if (dir < 0) {dir = 1; moveOnce();}
          break;
        }

        if (type) sawType = type;
        if (dir > 0 && !moveOnce(!first)) break;
      }
    }
    var result = skipAtomic(doc, Pos(line, ch), origDir, true);
    if (!possible) result.hitSide = true;
    return result;
  }

  // For relative vertical movement. Dir may be -1 or 1. Unit can be
  // "page" or "line". The resulting position will have a hitSide=true
  // property if it reached the end of the document.
  function findPosV(cm, pos, dir, unit) {
    var doc = cm.doc, x = pos.left, y;
    if (unit == "page") {
      var pageSize = Math.min(cm.display.wrapper.clientHeight, window.innerHeight || document.documentElement.clientHeight);
      y = pos.top + dir * (pageSize - (dir < 0 ? 1.5 : .5) * textHeight(cm.display));
    } else if (unit == "line") {
      y = dir > 0 ? pos.bottom + 3 : pos.top - 3;
    }
    for (;;) {
      var target = coordsChar(cm, x, y);
      if (!target.outside) break;
      if (dir < 0 ? y <= 0 : y >= doc.height) { target.hitSide = true; break; }
      y += dir * 5;
    }
    return target;
  }

  // EDITOR METHODS

  // The publicly visible API. Note that methodOp(f) means
  // 'wrap f in an operation, performed on its `this` parameter'.

  // This is not the complete set of editor methods. Most of the
  // methods defined on the Doc type are also injected into
  // CodeMirror.prototype, for backwards compatibility and
  // convenience.

  CodeMirror.prototype = {
    constructor: CodeMirror,
    focus: function(){window.focus(); this.display.input.focus();},

    setOption: function(option, value) {
      var options = this.options, old = options[option];
      if (options[option] == value && option != "mode") return;
      options[option] = value;
      if (optionHandlers.hasOwnProperty(option))
        operation(this, optionHandlers[option])(this, value, old);
    },

    getOption: function(option) {return this.options[option];},
    getDoc: function() {return this.doc;},

    addKeyMap: function(map, bottom) {
      this.state.keyMaps[bottom ? "push" : "unshift"](getKeyMap(map));
    },
    removeKeyMap: function(map) {
      var maps = this.state.keyMaps;
      for (var i = 0; i < maps.length; ++i)
        if (maps[i] == map || maps[i].name == map) {
          maps.splice(i, 1);
          return true;
        }
    },

    addOverlay: methodOp(function(spec, options) {
      var mode = spec.token ? spec : CodeMirror.getMode(this.options, spec);
      if (mode.startState) throw new Error("Overlays may not be stateful.");
      this.state.overlays.push({mode: mode, modeSpec: spec, opaque: options && options.opaque});
      this.state.modeGen++;
      regChange(this);
    }),
    removeOverlay: methodOp(function(spec) {
      var overlays = this.state.overlays;
      for (var i = 0; i < overlays.length; ++i) {
        var cur = overlays[i].modeSpec;
        if (cur == spec || typeof spec == "string" && cur.name == spec) {
          overlays.splice(i, 1);
          this.state.modeGen++;
          regChange(this);
          return;
        }
      }
    }),

    indentLine: methodOp(function(n, dir, aggressive) {
      if (typeof dir != "string" && typeof dir != "number") {
        if (dir == null) dir = this.options.smartIndent ? "smart" : "prev";
        else dir = dir ? "add" : "subtract";
      }
      if (isLine(this.doc, n)) indentLine(this, n, dir, aggressive);
    }),
    indentSelection: methodOp(function(how) {
      var ranges = this.doc.sel.ranges, end = -1;
      for (var i = 0; i < ranges.length; i++) {
        var range = ranges[i];
        if (!range.empty()) {
          var from = range.from(), to = range.to();
          var start = Math.max(end, from.line);
          end = Math.min(this.lastLine(), to.line - (to.ch ? 0 : 1)) + 1;
          for (var j = start; j < end; ++j)
            indentLine(this, j, how);
          var newRanges = this.doc.sel.ranges;
          if (from.ch == 0 && ranges.length == newRanges.length && newRanges[i].from().ch > 0)
            replaceOneSelection(this.doc, i, new Range(from, newRanges[i].to()), sel_dontScroll);
        } else if (range.head.line > end) {
          indentLine(this, range.head.line, how, true);
          end = range.head.line;
          if (i == this.doc.sel.primIndex) ensureCursorVisible(this);
        }
      }
    }),

    // Fetch the parser token for a given character. Useful for hacks
    // that want to inspect the mode state (say, for completion).
    getTokenAt: function(pos, precise) {
      return takeToken(this, pos, precise);
    },

    getLineTokens: function(line, precise) {
      return takeToken(this, Pos(line), precise, true);
    },

    getTokenTypeAt: function(pos) {
      pos = clipPos(this.doc, pos);
      var styles = getLineStyles(this, getLine(this.doc, pos.line));
      var before = 0, after = (styles.length - 1) / 2, ch = pos.ch;
      var type;
      if (ch == 0) type = styles[2];
      else for (;;) {
        var mid = (before + after) >> 1;
        if ((mid ? styles[mid * 2 - 1] : 0) >= ch) after = mid;
        else if (styles[mid * 2 + 1] < ch) before = mid + 1;
        else { type = styles[mid * 2 + 2]; break; }
      }
      var cut = type ? type.indexOf("cm-overlay ") : -1;
      return cut < 0 ? type : cut == 0 ? null : type.slice(0, cut - 1);
    },

    getModeAt: function(pos) {
      var mode = this.doc.mode;
      if (!mode.innerMode) return mode;
      return CodeMirror.innerMode(mode, this.getTokenAt(pos).state).mode;
    },

    getHelper: function(pos, type) {
      return this.getHelpers(pos, type)[0];
    },

    getHelpers: function(pos, type) {
      var found = [];
      if (!helpers.hasOwnProperty(type)) return found;
      var help = helpers[type], mode = this.getModeAt(pos);
      if (typeof mode[type] == "string") {
        if (help[mode[type]]) found.push(help[mode[type]]);
      } else if (mode[type]) {
        for (var i = 0; i < mode[type].length; i++) {
          var val = help[mode[type][i]];
          if (val) found.push(val);
        }
      } else if (mode.helperType && help[mode.helperType]) {
        found.push(help[mode.helperType]);
      } else if (help[mode.name]) {
        found.push(help[mode.name]);
      }
      for (var i = 0; i < help._global.length; i++) {
        var cur = help._global[i];
        if (cur.pred(mode, this) && indexOf(found, cur.val) == -1)
          found.push(cur.val);
      }
      return found;
    },

    getStateAfter: function(line, precise) {
      var doc = this.doc;
      line = clipLine(doc, line == null ? doc.first + doc.size - 1: line);
      return getStateBefore(this, line + 1, precise);
    },

    cursorCoords: function(start, mode) {
      var pos, range = this.doc.sel.primary();
      if (start == null) pos = range.head;
      else if (typeof start == "object") pos = clipPos(this.doc, start);
      else pos = start ? range.from() : range.to();
      return cursorCoords(this, pos, mode || "page");
    },

    charCoords: function(pos, mode) {
      return charCoords(this, clipPos(this.doc, pos), mode || "page");
    },

    coordsChar: function(coords, mode) {
      coords = fromCoordSystem(this, coords, mode || "page");
      return coordsChar(this, coords.left, coords.top);
    },

    lineAtHeight: function(height, mode) {
      height = fromCoordSystem(this, {top: height, left: 0}, mode || "page").top;
      return lineAtHeight(this.doc, height + this.display.viewOffset);
    },
    heightAtLine: function(line, mode) {
      var end = false, lineObj;
      if (typeof line == "number") {
        var last = this.doc.first + this.doc.size - 1;
        if (line < this.doc.first) line = this.doc.first;
        else if (line > last) { line = last; end = true; }
        lineObj = getLine(this.doc, line);
      } else {
        lineObj = line;
      }
      return intoCoordSystem(this, lineObj, {top: 0, left: 0}, mode || "page").top +
        (end ? this.doc.height - heightAtLine(lineObj) : 0);
    },

    defaultTextHeight: function() { return textHeight(this.display); },
    defaultCharWidth: function() { return charWidth(this.display); },

    setGutterMarker: methodOp(function(line, gutterID, value) {
      return changeLine(this.doc, line, "gutter", function(line) {
        var markers = line.gutterMarkers || (line.gutterMarkers = {});
        markers[gutterID] = value;
        if (!value && isEmpty(markers)) line.gutterMarkers = null;
        return true;
      });
    }),

    clearGutter: methodOp(function(gutterID) {
      var cm = this, doc = cm.doc, i = doc.first;
      doc.iter(function(line) {
        if (line.gutterMarkers && line.gutterMarkers[gutterID]) {
          line.gutterMarkers[gutterID] = null;
          regLineChange(cm, i, "gutter");
          if (isEmpty(line.gutterMarkers)) line.gutterMarkers = null;
        }
        ++i;
      });
    }),

    lineInfo: function(line) {
      if (typeof line == "number") {
        if (!isLine(this.doc, line)) return null;
        var n = line;
        line = getLine(this.doc, line);
        if (!line) return null;
      } else {
        var n = lineNo(line);
        if (n == null) return null;
      }
      return {line: n, handle: line, text: line.text, gutterMarkers: line.gutterMarkers,
              textClass: line.textClass, bgClass: line.bgClass, wrapClass: line.wrapClass,
              widgets: line.widgets};
    },

    getViewport: function() { return {from: this.display.viewFrom, to: this.display.viewTo};},

    addWidget: function(pos, node, scroll, vert, horiz) {
      var display = this.display;
      pos = cursorCoords(this, clipPos(this.doc, pos));
      var top = pos.bottom, left = pos.left;
      node.style.position = "absolute";
      node.setAttribute("cm-ignore-events", "true");
      this.display.input.setUneditable(node);
      display.sizer.appendChild(node);
      if (vert == "over") {
        top = pos.top;
      } else if (vert == "above" || vert == "near") {
        var vspace = Math.max(display.wrapper.clientHeight, this.doc.height),
        hspace = Math.max(display.sizer.clientWidth, display.lineSpace.clientWidth);
        // Default to positioning above (if specified and possible); otherwise default to positioning below
        if ((vert == 'above' || pos.bottom + node.offsetHeight > vspace) && pos.top > node.offsetHeight)
          top = pos.top - node.offsetHeight;
        else if (pos.bottom + node.offsetHeight <= vspace)
          top = pos.bottom;
        if (left + node.offsetWidth > hspace)
          left = hspace - node.offsetWidth;
      }
      node.style.top = top + "px";
      node.style.left = node.style.right = "";
      if (horiz == "right") {
        left = display.sizer.clientWidth - node.offsetWidth;
        node.style.right = "0px";
      } else {
        if (horiz == "left") left = 0;
        else if (horiz == "middle") left = (display.sizer.clientWidth - node.offsetWidth) / 2;
        node.style.left = left + "px";
      }
      if (scroll)
        scrollIntoView(this, left, top, left + node.offsetWidth, top + node.offsetHeight);
    },

    triggerOnKeyDown: methodOp(onKeyDown),
    triggerOnKeyPress: methodOp(onKeyPress),
    triggerOnKeyUp: onKeyUp,

    execCommand: function(cmd) {
      if (commands.hasOwnProperty(cmd))
        return commands[cmd].call(null, this);
    },

    triggerElectric: methodOp(function(text) { triggerElectric(this, text); }),

    findPosH: function(from, amount, unit, visually) {
      var dir = 1;
      if (amount < 0) { dir = -1; amount = -amount; }
      for (var i = 0, cur = clipPos(this.doc, from); i < amount; ++i) {
        cur = findPosH(this.doc, cur, dir, unit, visually);
        if (cur.hitSide) break;
      }
      return cur;
    },

    moveH: methodOp(function(dir, unit) {
      var cm = this;
      cm.extendSelectionsBy(function(range) {
        if (cm.display.shift || cm.doc.extend || range.empty())
          return findPosH(cm.doc, range.head, dir, unit, cm.options.rtlMoveVisually);
        else
          return dir < 0 ? range.from() : range.to();
      }, sel_move);
    }),

    deleteH: methodOp(function(dir, unit) {
      var sel = this.doc.sel, doc = this.doc;
      if (sel.somethingSelected())
        doc.replaceSelection("", null, "+delete");
      else
        deleteNearSelection(this, function(range) {
          var other = findPosH(doc, range.head, dir, unit, false);
          return dir < 0 ? {from: other, to: range.head} : {from: range.head, to: other};
        });
    }),

    findPosV: function(from, amount, unit, goalColumn) {
      var dir = 1, x = goalColumn;
      if (amount < 0) { dir = -1; amount = -amount; }
      for (var i = 0, cur = clipPos(this.doc, from); i < amount; ++i) {
        var coords = cursorCoords(this, cur, "div");
        if (x == null) x = coords.left;
        else coords.left = x;
        cur = findPosV(this, coords, dir, unit);
        if (cur.hitSide) break;
      }
      return cur;
    },

    moveV: methodOp(function(dir, unit) {
      var cm = this, doc = this.doc, goals = [];
      var collapse = !cm.display.shift && !doc.extend && doc.sel.somethingSelected();
      doc.extendSelectionsBy(function(range) {
        if (collapse)
          return dir < 0 ? range.from() : range.to();
        var headPos = cursorCoords(cm, range.head, "div");
        if (range.goalColumn != null) headPos.left = range.goalColumn;
        goals.push(headPos.left);
        var pos = findPosV(cm, headPos, dir, unit);
        if (unit == "page" && range == doc.sel.primary())
          addToScrollPos(cm, null, charCoords(cm, pos, "div").top - headPos.top);
        return pos;
      }, sel_move);
      if (goals.length) for (var i = 0; i < doc.sel.ranges.length; i++)
        doc.sel.ranges[i].goalColumn = goals[i];
    }),

    // Find the word at the given position (as returned by coordsChar).
    findWordAt: function(pos) {
      var doc = this.doc, line = getLine(doc, pos.line).text;
      var start = pos.ch, end = pos.ch;
      if (line) {
        var helper = this.getHelper(pos, "wordChars");
        if ((pos.xRel < 0 || end == line.length) && start) --start; else ++end;
        var startChar = line.charAt(start);
        var check = isWordChar(startChar, helper)
          ? function(ch) { return isWordChar(ch, helper); }
          : /\s/.test(startChar) ? function(ch) {return /\s/.test(ch);}
          : function(ch) {return !/\s/.test(ch) && !isWordChar(ch);};
        while (start > 0 && check(line.charAt(start - 1))) --start;
        while (end < line.length && check(line.charAt(end))) ++end;
      }
      return new Range(Pos(pos.line, start), Pos(pos.line, end));
    },

    toggleOverwrite: function(value) {
      if (value != null && value == this.state.overwrite) return;
      if (this.state.overwrite = !this.state.overwrite)
        addClass(this.display.cursorDiv, "CodeMirror-overwrite");
      else
        rmClass(this.display.cursorDiv, "CodeMirror-overwrite");

      signal(this, "overwriteToggle", this, this.state.overwrite);
    },
    hasFocus: function() { return this.display.input.getField() == activeElt(); },

    scrollTo: methodOp(function(x, y) {
      if (x != null || y != null) resolveScrollToPos(this);
      if (x != null) this.curOp.scrollLeft = x;
      if (y != null) this.curOp.scrollTop = y;
    }),
    getScrollInfo: function() {
      var scroller = this.display.scroller;
      return {left: scroller.scrollLeft, top: scroller.scrollTop,
              height: scroller.scrollHeight - scrollGap(this) - this.display.barHeight,
              width: scroller.scrollWidth - scrollGap(this) - this.display.barWidth,
              clientHeight: displayHeight(this), clientWidth: displayWidth(this)};
    },

    scrollIntoView: methodOp(function(range, margin) {
      if (range == null) {
        range = {from: this.doc.sel.primary().head, to: null};
        if (margin == null) margin = this.options.cursorScrollMargin;
      } else if (typeof range == "number") {
        range = {from: Pos(range, 0), to: null};
      } else if (range.from == null) {
        range = {from: range, to: null};
      }
      if (!range.to) range.to = range.from;
      range.margin = margin || 0;

      if (range.from.line != null) {
        resolveScrollToPos(this);
        this.curOp.scrollToPos = range;
      } else {
        var sPos = calculateScrollPos(this, Math.min(range.from.left, range.to.left),
                                      Math.min(range.from.top, range.to.top) - range.margin,
                                      Math.max(range.from.right, range.to.right),
                                      Math.max(range.from.bottom, range.to.bottom) + range.margin);
        this.scrollTo(sPos.scrollLeft, sPos.scrollTop);
      }
    }),

    setSize: methodOp(function(width, height) {
      var cm = this;
      function interpret(val) {
        return typeof val == "number" || /^\d+$/.test(String(val)) ? val + "px" : val;
      }
      if (width != null) cm.display.wrapper.style.width = interpret(width);
      if (height != null) cm.display.wrapper.style.height = interpret(height);
      if (cm.options.lineWrapping) clearLineMeasurementCache(this);
      var lineNo = cm.display.viewFrom;
      cm.doc.iter(lineNo, cm.display.viewTo, function(line) {
        if (line.widgets) for (var i = 0; i < line.widgets.length; i++)
          if (line.widgets[i].noHScroll) { regLineChange(cm, lineNo, "widget"); break; }
        ++lineNo;
      });
      cm.curOp.forceUpdate = true;
      signal(cm, "refresh", this);
    }),

    operation: function(f){return runInOp(this, f);},

    refresh: methodOp(function() {
      var oldHeight = this.display.cachedTextHeight;
      regChange(this);
      this.curOp.forceUpdate = true;
      clearCaches(this);
      this.scrollTo(this.doc.scrollLeft, this.doc.scrollTop);
      updateGutterSpace(this);
      if (oldHeight == null || Math.abs(oldHeight - textHeight(this.display)) > .5)
        estimateLineHeights(this);
      signal(this, "refresh", this);
    }),

    swapDoc: methodOp(function(doc) {
      var old = this.doc;
      old.cm = null;
      attachDoc(this, doc);
      clearCaches(this);
      this.display.input.reset();
      this.scrollTo(doc.scrollLeft, doc.scrollTop);
      this.curOp.forceScroll = true;
      signalLater(this, "swapDoc", this, old);
      return old;
    }),

    getInputField: function(){return this.display.input.getField();},
    getWrapperElement: function(){return this.display.wrapper;},
    getScrollerElement: function(){return this.display.scroller;},
    getGutterElement: function(){return this.display.gutters;}
  };
  eventMixin(CodeMirror);

  // OPTION DEFAULTS

  // The default configuration options.
  var defaults = CodeMirror.defaults = {};
  // Functions to run when options are changed.
  var optionHandlers = CodeMirror.optionHandlers = {};

  function option(name, deflt, handle, notOnInit) {
    CodeMirror.defaults[name] = deflt;
    if (handle) optionHandlers[name] =
      notOnInit ? function(cm, val, old) {if (old != Init) handle(cm, val, old);} : handle;
  }

  // Passed to option handlers when there is no old value.
  var Init = CodeMirror.Init = {toString: function(){return "CodeMirror.Init";}};

  // These two are, on init, called from the constructor because they
  // have to be initialized before the editor can start at all.
  option("value", "", function(cm, val) {
    cm.setValue(val);
  }, true);
  option("mode", null, function(cm, val) {
    cm.doc.modeOption = val;
    loadMode(cm);
  }, true);

  option("indentUnit", 2, loadMode, true);
  option("indentWithTabs", false);
  option("smartIndent", true);
  option("tabSize", 4, function(cm) {
    resetModeState(cm);
    clearCaches(cm);
    regChange(cm);
  }, true);
  option("lineSeparator", null, function(cm, val) {
    cm.doc.lineSep = val;
    if (!val) return;
    var newBreaks = [], lineNo = cm.doc.first;
    cm.doc.iter(function(line) {
      for (var pos = 0;;) {
        var found = line.text.indexOf(val, pos);
        if (found == -1) break;
        pos = found + val.length;
        newBreaks.push(Pos(lineNo, found));
      }
      lineNo++;
    });
    for (var i = newBreaks.length - 1; i >= 0; i--)
      replaceRange(cm.doc, val, newBreaks[i], Pos(newBreaks[i].line, newBreaks[i].ch + val.length))
  });
  option("specialChars", /[\t\u0000-\u0019\u00ad\u200b-\u200f\u2028\u2029\ufeff]/g, function(cm, val, old) {
    cm.state.specialChars = new RegExp(val.source + (val.test("\t") ? "" : "|\t"), "g");
    if (old != CodeMirror.Init) cm.refresh();
  });
  option("specialCharPlaceholder", defaultSpecialCharPlaceholder, function(cm) {cm.refresh();}, true);
  option("electricChars", true);
  option("inputStyle", mobile ? "contenteditable" : "textarea", function() {
    throw new Error("inputStyle can not (yet) be changed in a running editor"); // FIXME
  }, true);
  option("rtlMoveVisually", !windows);
  option("wholeLineUpdateBefore", true);

  option("theme", "default", function(cm) {
    themeChanged(cm);
    guttersChanged(cm);
  }, true);
  option("keyMap", "default", function(cm, val, old) {
    var next = getKeyMap(val);
    var prev = old != CodeMirror.Init && getKeyMap(old);
    if (prev && prev.detach) prev.detach(cm, next);
    if (next.attach) next.attach(cm, prev || null);
  });
  option("extraKeys", null);

  option("lineWrapping", false, wrappingChanged, true);
  option("gutters", [], function(cm) {
    setGuttersForLineNumbers(cm.options);
    guttersChanged(cm);
  }, true);
  option("fixedGutter", true, function(cm, val) {
    cm.display.gutters.style.left = val ? compensateForHScroll(cm.display) + "px" : "0";
    cm.refresh();
  }, true);
  option("coverGutterNextToScrollbar", false, function(cm) {updateScrollbars(cm);}, true);
  option("scrollbarStyle", "native", function(cm) {
    initScrollbars(cm);
    updateScrollbars(cm);
    cm.display.scrollbars.setScrollTop(cm.doc.scrollTop);
    cm.display.scrollbars.setScrollLeft(cm.doc.scrollLeft);
  }, true);
  option("lineNumbers", false, function(cm) {
    setGuttersForLineNumbers(cm.options);
    guttersChanged(cm);
  }, true);
  option("firstLineNumber", 1, guttersChanged, true);
  option("lineNumberFormatter", function(integer) {return integer;}, guttersChanged, true);
  option("showCursorWhenSelecting", false, updateSelection, true);

  option("resetSelectionOnContextMenu", true);
  option("lineWiseCopyCut", true);

  option("readOnly", false, function(cm, val) {
    if (val == "nocursor") {
      onBlur(cm);
      cm.display.input.blur();
      cm.display.disabled = true;
    } else {
      cm.display.disabled = false;
    }
    cm.display.input.readOnlyChanged(val)
  });
  option("disableInput", false, function(cm, val) {if (!val) cm.display.input.reset();}, true);
  option("dragDrop", true, dragDropChanged);
  option("allowDropFileTypes", null);

  option("cursorBlinkRate", 530);
  option("cursorScrollMargin", 0);
  option("cursorHeight", 1, updateSelection, true);
  option("singleCursorHeightPerLine", true, updateSelection, true);
  option("workTime", 100);
  option("workDelay", 100);
  option("flattenSpans", true, resetModeState, true);
  option("addModeClass", false, resetModeState, true);
  option("pollInterval", 100);
  option("undoDepth", 200, function(cm, val){cm.doc.history.undoDepth = val;});
  option("historyEventDelay", 1250);
  option("viewportMargin", 10, function(cm){cm.refresh();}, true);
  option("maxHighlightLength", 10000, resetModeState, true);
  option("moveInputWithCursor", true, function(cm, val) {
    if (!val) cm.display.input.resetPosition();
  });

  option("tabindex", null, function(cm, val) {
    cm.display.input.getField().tabIndex = val || "";
  });
  option("autofocus", null);

  // MODE DEFINITION AND QUERYING

  // Known modes, by name and by MIME
  var modes = CodeMirror.modes = {}, mimeModes = CodeMirror.mimeModes = {};

  // Extra arguments are stored as the mode's dependencies, which is
  // used by (legacy) mechanisms like loadmode.js to automatically
  // load a mode. (Preferred mechanism is the require/define calls.)
  CodeMirror.defineMode = function(name, mode) {
    if (!CodeMirror.defaults.mode && name != "null") CodeMirror.defaults.mode = name;
    if (arguments.length > 2)
      mode.dependencies = Array.prototype.slice.call(arguments, 2);
    modes[name] = mode;
  };

  CodeMirror.defineMIME = function(mime, spec) {
    mimeModes[mime] = spec;
  };

  // Given a MIME type, a {name, ...options} config object, or a name
  // string, return a mode config object.
  CodeMirror.resolveMode = function(spec) {
    if (typeof spec == "string" && mimeModes.hasOwnProperty(spec)) {
      spec = mimeModes[spec];
    } else if (spec && typeof spec.name == "string" && mimeModes.hasOwnProperty(spec.name)) {
      var found = mimeModes[spec.name];
      if (typeof found == "string") found = {name: found};
      spec = createObj(found, spec);
      spec.name = found.name;
    } else if (typeof spec == "string" && /^[\w\-]+\/[\w\-]+\+xml$/.test(spec)) {
      return CodeMirror.resolveMode("application/xml");
    }
    if (typeof spec == "string") return {name: spec};
    else return spec || {name: "null"};
  };

  // Given a mode spec (anything that resolveMode accepts), find and
  // initialize an actual mode object.
  CodeMirror.getMode = function(options, spec) {
    var spec = CodeMirror.resolveMode(spec);
    var mfactory = modes[spec.name];
    if (!mfactory) return CodeMirror.getMode(options, "text/plain");
    var modeObj = mfactory(options, spec);
    if (modeExtensions.hasOwnProperty(spec.name)) {
      var exts = modeExtensions[spec.name];
      for (var prop in exts) {
        if (!exts.hasOwnProperty(prop)) continue;
        if (modeObj.hasOwnProperty(prop)) modeObj["_" + prop] = modeObj[prop];
        modeObj[prop] = exts[prop];
      }
    }
    modeObj.name = spec.name;
    if (spec.helperType) modeObj.helperType = spec.helperType;
    if (spec.modeProps) for (var prop in spec.modeProps)
      modeObj[prop] = spec.modeProps[prop];

    return modeObj;
  };

  // Minimal default mode.
  CodeMirror.defineMode("null", function() {
    return {token: function(stream) {stream.skipToEnd();}};
  });
  CodeMirror.defineMIME("text/plain", "null");

  // This can be used to attach properties to mode objects from
  // outside the actual mode definition.
  var modeExtensions = CodeMirror.modeExtensions = {};
  CodeMirror.extendMode = function(mode, properties) {
    var exts = modeExtensions.hasOwnProperty(mode) ? modeExtensions[mode] : (modeExtensions[mode] = {});
    copyObj(properties, exts);
  };

  // EXTENSIONS

  CodeMirror.defineExtension = function(name, func) {
    CodeMirror.prototype[name] = func;
  };
  CodeMirror.defineDocExtension = function(name, func) {
    Doc.prototype[name] = func;
  };
  CodeMirror.defineOption = option;

  var initHooks = [];
  CodeMirror.defineInitHook = function(f) {initHooks.push(f);};

  var helpers = CodeMirror.helpers = {};
  CodeMirror.registerHelper = function(type, name, value) {
    if (!helpers.hasOwnProperty(type)) helpers[type] = CodeMirror[type] = {_global: []};
    helpers[type][name] = value;
  };
  CodeMirror.registerGlobalHelper = function(type, name, predicate, value) {
    CodeMirror.registerHelper(type, name, value);
    helpers[type]._global.push({pred: predicate, val: value});
  };

  // MODE STATE HANDLING

  // Utility functions for working with state. Exported because nested
  // modes need to do this for their inner modes.

  var copyState = CodeMirror.copyState = function(mode, state) {
    if (state === true) return state;
    if (mode.copyState) return mode.copyState(state);
    var nstate = {};
    for (var n in state) {
      var val = state[n];
      if (val instanceof Array) val = val.concat([]);
      nstate[n] = val;
    }
    return nstate;
  };

  var startState = CodeMirror.startState = function(mode, a1, a2) {
    return mode.startState ? mode.startState(a1, a2) : true;
  };

  // Given a mode and a state (for that mode), find the inner mode and
  // state at the position that the state refers to.
  CodeMirror.innerMode = function(mode, state) {
    while (mode.innerMode) {
      var info = mode.innerMode(state);
      if (!info || info.mode == mode) break;
      state = info.state;
      mode = info.mode;
    }
    return info || {mode: mode, state: state};
  };

  // STANDARD COMMANDS

  // Commands are parameter-less actions that can be performed on an
  // editor, mostly used for keybindings.
  var commands = CodeMirror.commands = {
    selectAll: function(cm) {cm.setSelection(Pos(cm.firstLine(), 0), Pos(cm.lastLine()), sel_dontScroll);},
    singleSelection: function(cm) {
      cm.setSelection(cm.getCursor("anchor"), cm.getCursor("head"), sel_dontScroll);
    },
    killLine: function(cm) {
      deleteNearSelection(cm, function(range) {
        if (range.empty()) {
          var len = getLine(cm.doc, range.head.line).text.length;
          if (range.head.ch == len && range.head.line < cm.lastLine())
            return {from: range.head, to: Pos(range.head.line + 1, 0)};
          else
            return {from: range.head, to: Pos(range.head.line, len)};
        } else {
          return {from: range.from(), to: range.to()};
        }
      });
    },
    deleteLine: function(cm) {
      deleteNearSelection(cm, function(range) {
        return {from: Pos(range.from().line, 0),
                to: clipPos(cm.doc, Pos(range.to().line + 1, 0))};
      });
    },
    delLineLeft: function(cm) {
      deleteNearSelection(cm, function(range) {
        return {from: Pos(range.from().line, 0), to: range.from()};
      });
    },
    delWrappedLineLeft: function(cm) {
      deleteNearSelection(cm, function(range) {
        var top = cm.charCoords(range.head, "div").top + 5;
        var leftPos = cm.coordsChar({left: 0, top: top}, "div");
        return {from: leftPos, to: range.from()};
      });
    },
    delWrappedLineRight: function(cm) {
      deleteNearSelection(cm, function(range) {
        var top = cm.charCoords(range.head, "div").top + 5;
        var rightPos = cm.coordsChar({left: cm.display.lineDiv.offsetWidth + 100, top: top}, "div");
        return {from: range.from(), to: rightPos };
      });
    },
    undo: function(cm) {cm.undo();},
    redo: function(cm) {cm.redo();},
    undoSelection: function(cm) {cm.undoSelection();},
    redoSelection: function(cm) {cm.redoSelection();},
    goDocStart: function(cm) {cm.extendSelection(Pos(cm.firstLine(), 0));},
    goDocEnd: function(cm) {cm.extendSelection(Pos(cm.lastLine()));},
    goLineStart: function(cm) {
      cm.extendSelectionsBy(function(range) { return lineStart(cm, range.head.line); },
                            {origin: "+move", bias: 1});
    },
    goLineStartSmart: function(cm) {
      cm.extendSelectionsBy(function(range) {
        return lineStartSmart(cm, range.head);
      }, {origin: "+move", bias: 1});
    },
    goLineEnd: function(cm) {
      cm.extendSelectionsBy(function(range) { return lineEnd(cm, range.head.line); },
                            {origin: "+move", bias: -1});
    },
    goLineRight: function(cm) {
      cm.extendSelectionsBy(function(range) {
        var top = cm.charCoords(range.head, "div").top + 5;
        return cm.coordsChar({left: cm.display.lineDiv.offsetWidth + 100, top: top}, "div");
      }, sel_move);
    },
    goLineLeft: function(cm) {
      cm.extendSelectionsBy(function(range) {
        var top = cm.charCoords(range.head, "div").top + 5;
        return cm.coordsChar({left: 0, top: top}, "div");
      }, sel_move);
    },
    goLineLeftSmart: function(cm) {
      cm.extendSelectionsBy(function(range) {
        var top = cm.charCoords(range.head, "div").top + 5;
        var pos = cm.coordsChar({left: 0, top: top}, "div");
        if (pos.ch < cm.getLine(pos.line).search(/\S/)) return lineStartSmart(cm, range.head);
        return pos;
      }, sel_move);
    },
    goLineUp: function(cm) {cm.moveV(-1, "line");},
    goLineDown: function(cm) {cm.moveV(1, "line");},
    goPageUp: function(cm) {cm.moveV(-1, "page");},
    goPageDown: function(cm) {cm.moveV(1, "page");},
    goCharLeft: function(cm) {cm.moveH(-1, "char");},
    goCharRight: function(cm) {cm.moveH(1, "char");},
    goColumnLeft: function(cm) {cm.moveH(-1, "column");},
    goColumnRight: function(cm) {cm.moveH(1, "column");},
    goWordLeft: function(cm) {cm.moveH(-1, "word");},
    goGroupRight: function(cm) {cm.moveH(1, "group");},
    goGroupLeft: function(cm) {cm.moveH(-1, "group");},
    goWordRight: function(cm) {cm.moveH(1, "word");},
    delCharBefore: function(cm) {cm.deleteH(-1, "char");},
    delCharAfter: function(cm) {cm.deleteH(1, "char");},
    delWordBefore: function(cm) {cm.deleteH(-1, "word");},
    delWordAfter: function(cm) {cm.deleteH(1, "word");},
    delGroupBefore: function(cm) {cm.deleteH(-1, "group");},
    delGroupAfter: function(cm) {cm.deleteH(1, "group");},
    indentAuto: function(cm) {cm.indentSelection("smart");},
    indentMore: function(cm) {cm.indentSelection("add");},
    indentLess: function(cm) {cm.indentSelection("subtract");},
    insertTab: function(cm) {cm.replaceSelection("\t");},
    insertSoftTab: function(cm) {
      var spaces = [], ranges = cm.listSelections(), tabSize = cm.options.tabSize;
      for (var i = 0; i < ranges.length; i++) {
        var pos = ranges[i].from();
        var col = countColumn(cm.getLine(pos.line), pos.ch, tabSize);
        spaces.push(new Array(tabSize - col % tabSize + 1).join(" "));
      }
      cm.replaceSelections(spaces);
    },
    defaultTab: function(cm) {
      if (cm.somethingSelected()) cm.indentSelection("add");
      else cm.execCommand("insertTab");
    },
    transposeChars: function(cm) {
      runInOp(cm, function() {
        var ranges = cm.listSelections(), newSel = [];
        for (var i = 0; i < ranges.length; i++) {
          var cur = ranges[i].head, line = getLine(cm.doc, cur.line).text;
          if (line) {
            if (cur.ch == line.length) cur = new Pos(cur.line, cur.ch - 1);
            if (cur.ch > 0) {
              cur = new Pos(cur.line, cur.ch + 1);
              cm.replaceRange(line.charAt(cur.ch - 1) + line.charAt(cur.ch - 2),
                              Pos(cur.line, cur.ch - 2), cur, "+transpose");
            } else if (cur.line > cm.doc.first) {
              var prev = getLine(cm.doc, cur.line - 1).text;
              if (prev)
                cm.replaceRange(line.charAt(0) + cm.doc.lineSeparator() +
                                prev.charAt(prev.length - 1),
                                Pos(cur.line - 1, prev.length - 1), Pos(cur.line, 1), "+transpose");
            }
          }
          newSel.push(new Range(cur, cur));
        }
        cm.setSelections(newSel);
      });
    },
    newlineAndIndent: function(cm) {
      runInOp(cm, function() {
        var len = cm.listSelections().length;
        for (var i = 0; i < len; i++) {
          var range = cm.listSelections()[i];
          cm.replaceRange(cm.doc.lineSeparator(), range.anchor, range.head, "+input");
          cm.indentLine(range.from().line + 1, null, true);
        }
        ensureCursorVisible(cm);
      });
    },
    toggleOverwrite: function(cm) {cm.toggleOverwrite();}
  };


  // STANDARD KEYMAPS

  var keyMap = CodeMirror.keyMap = {};

  keyMap.basic = {
    "Left": "goCharLeft", "Right": "goCharRight", "Up": "goLineUp", "Down": "goLineDown",
    "End": "goLineEnd", "Home": "goLineStartSmart", "PageUp": "goPageUp", "PageDown": "goPageDown",
    "Delete": "delCharAfter", "Backspace": "delCharBefore", "Shift-Backspace": "delCharBefore",
    "Tab": "defaultTab", "Shift-Tab": "indentAuto",
    "Enter": "newlineAndIndent", "Insert": "toggleOverwrite",
    "Esc": "singleSelection"
  };
  // Note that the save and find-related commands aren't defined by
  // default. User code or addons can define them. Unknown commands
  // are simply ignored.
  keyMap.pcDefault = {
    "Ctrl-A": "selectAll", "Ctrl-D": "deleteLine", "Ctrl-Z": "undo", "Shift-Ctrl-Z": "redo", "Ctrl-Y": "redo",
    "Ctrl-Home": "goDocStart", "Ctrl-End": "goDocEnd", "Ctrl-Up": "goLineUp", "Ctrl-Down": "goLineDown",
    "Ctrl-Left": "goGroupLeft", "Ctrl-Right": "goGroupRight", "Alt-Left": "goLineStart", "Alt-Right": "goLineEnd",
    "Ctrl-Backspace": "delGroupBefore", "Ctrl-Delete": "delGroupAfter", "Ctrl-S": "save", "Ctrl-F": "find",
    "Ctrl-G": "findNext", "Shift-Ctrl-G": "findPrev", "Shift-Ctrl-F": "replace", "Shift-Ctrl-R": "replaceAll",
    "Ctrl-[": "indentLess", "Ctrl-]": "indentMore",
    "Ctrl-U": "undoSelection", "Shift-Ctrl-U": "redoSelection", "Alt-U": "redoSelection",
    fallthrough: "basic"
  };
  // Very basic readline/emacs-style bindings, which are standard on Mac.
  keyMap.emacsy = {
    "Ctrl-F": "goCharRight", "Ctrl-B": "goCharLeft", "Ctrl-P": "goLineUp", "Ctrl-N": "goLineDown",
    "Alt-F": "goWordRight", "Alt-B": "goWordLeft", "Ctrl-A": "goLineStart", "Ctrl-E": "goLineEnd",
    "Ctrl-V": "goPageDown", "Shift-Ctrl-V": "goPageUp", "Ctrl-D": "delCharAfter", "Ctrl-H": "delCharBefore",
    "Alt-D": "delWordAfter", "Alt-Backspace": "delWordBefore", "Ctrl-K": "killLine", "Ctrl-T": "transposeChars"
  };
  keyMap.macDefault = {
    "Cmd-A": "selectAll", "Cmd-D": "deleteLine", "Cmd-Z": "undo", "Shift-Cmd-Z": "redo", "Cmd-Y": "redo",
    "Cmd-Home": "goDocStart", "Cmd-Up": "goDocStart", "Cmd-End": "goDocEnd", "Cmd-Down": "goDocEnd", "Alt-Left": "goGroupLeft",
    "Alt-Right": "goGroupRight", "Cmd-Left": "goLineLeft", "Cmd-Right": "goLineRight", "Alt-Backspace": "delGroupBefore",
    "Ctrl-Alt-Backspace": "delGroupAfter", "Alt-Delete": "delGroupAfter", "Cmd-S": "save", "Cmd-F": "find",
    "Cmd-G": "findNext", "Shift-Cmd-G": "findPrev", "Cmd-Alt-F": "replace", "Shift-Cmd-Alt-F": "replaceAll",
    "Cmd-[": "indentLess", "Cmd-]": "indentMore", "Cmd-Backspace": "delWrappedLineLeft", "Cmd-Delete": "delWrappedLineRight",
    "Cmd-U": "undoSelection", "Shift-Cmd-U": "redoSelection", "Ctrl-Up": "goDocStart", "Ctrl-Down": "goDocEnd",
    fallthrough: ["basic", "emacsy"]
  };
  keyMap["default"] = mac ? keyMap.macDefault : keyMap.pcDefault;

  // KEYMAP DISPATCH

  function normalizeKeyName(name) {
    var parts = name.split(/-(?!$)/), name = parts[parts.length - 1];
    var alt, ctrl, shift, cmd;
    for (var i = 0; i < parts.length - 1; i++) {
      var mod = parts[i];
      if (/^(cmd|meta|m)$/i.test(mod)) cmd = true;
      else if (/^a(lt)?$/i.test(mod)) alt = true;
      else if (/^(c|ctrl|control)$/i.test(mod)) ctrl = true;
      else if (/^s(hift)$/i.test(mod)) shift = true;
      else throw new Error("Unrecognized modifier name: " + mod);
    }
    if (alt) name = "Alt-" + name;
    if (ctrl) name = "Ctrl-" + name;
    if (cmd) name = "Cmd-" + name;
    if (shift) name = "Shift-" + name;
    return name;
  }

  // This is a kludge to keep keymaps mostly working as raw objects
  // (backwards compatibility) while at the same time support features
  // like normalization and multi-stroke key bindings. It compiles a
  // new normalized keymap, and then updates the old object to reflect
  // this.
  CodeMirror.normalizeKeyMap = function(keymap) {
    var copy = {};
    for (var keyname in keymap) if (keymap.hasOwnProperty(keyname)) {
      var value = keymap[keyname];
      if (/^(name|fallthrough|(de|at)tach)$/.test(keyname)) continue;
      if (value == "...") { delete keymap[keyname]; continue; }

      var keys = map(keyname.split(" "), normalizeKeyName);
      for (var i = 0; i < keys.length; i++) {
        var val, name;
        if (i == keys.length - 1) {
          name = keys.join(" ");
          val = value;
        } else {
          name = keys.slice(0, i + 1).join(" ");
          val = "...";
        }
        var prev = copy[name];
        if (!prev) copy[name] = val;
        else if (prev != val) throw new Error("Inconsistent bindings for " + name);
      }
      delete keymap[keyname];
    }
    for (var prop in copy) keymap[prop] = copy[prop];
    return keymap;
  };

  var lookupKey = CodeMirror.lookupKey = function(key, map, handle, context) {
    map = getKeyMap(map);
    var found = map.call ? map.call(key, context) : map[key];
    if (found === false) return "nothing";
    if (found === "...") return "multi";
    if (found != null && handle(found)) return "handled";

    if (map.fallthrough) {
      if (Object.prototype.toString.call(map.fallthrough) != "[object Array]")
        return lookupKey(key, map.fallthrough, handle, context);
      for (var i = 0; i < map.fallthrough.length; i++) {
        var result = lookupKey(key, map.fallthrough[i], handle, context);
        if (result) return result;
      }
    }
  };

  // Modifier key presses don't count as 'real' key presses for the
  // purpose of keymap fallthrough.
  var isModifierKey = CodeMirror.isModifierKey = function(value) {
    var name = typeof value == "string" ? value : keyNames[value.keyCode];
    return name == "Ctrl" || name == "Alt" || name == "Shift" || name == "Mod";
  };

  // Look up the name of a key as indicated by an event object.
  var keyName = CodeMirror.keyName = function(event, noShift) {
    if (presto && event.keyCode == 34 && event["char"]) return false;
    var base = keyNames[event.keyCode], name = base;
    if (name == null || event.altGraphKey) return false;
    if (event.altKey && base != "Alt") name = "Alt-" + name;
    if ((flipCtrlCmd ? event.metaKey : event.ctrlKey) && base != "Ctrl") name = "Ctrl-" + name;
    if ((flipCtrlCmd ? event.ctrlKey : event.metaKey) && base != "Cmd") name = "Cmd-" + name;
    if (!noShift && event.shiftKey && base != "Shift") name = "Shift-" + name;
    return name;
  };

  function getKeyMap(val) {
    return typeof val == "string" ? keyMap[val] : val;
  }

  // FROMTEXTAREA

  CodeMirror.fromTextArea = function(textarea, options) {
    options = options ? copyObj(options) : {};
    options.value = textarea.value;
    if (!options.tabindex && textarea.tabIndex)
      options.tabindex = textarea.tabIndex;
    if (!options.placeholder && textarea.placeholder)
      options.placeholder = textarea.placeholder;
    // Set autofocus to true if this textarea is focused, or if it has
    // autofocus and no other element is focused.
    if (options.autofocus == null) {
      var hasFocus = activeElt();
      options.autofocus = hasFocus == textarea ||
        textarea.getAttribute("autofocus") != null && hasFocus == document.body;
    }

    function save() {textarea.value = cm.getValue();}
    if (textarea.form) {
      on(textarea.form, "submit", save);
      // Deplorable hack to make the submit method do the right thing.
      if (!options.leaveSubmitMethodAlone) {
        var form = textarea.form, realSubmit = form.submit;
        try {
          var wrappedSubmit = form.submit = function() {
            save();
            form.submit = realSubmit;
            form.submit();
            form.submit = wrappedSubmit;
          };
        } catch(e) {}
      }
    }

    options.finishInit = function(cm) {
      cm.save = save;
      cm.getTextArea = function() { return textarea; };
      cm.toTextArea = function() {
        cm.toTextArea = isNaN; // Prevent this from being ran twice
        save();
        textarea.parentNode.removeChild(cm.getWrapperElement());
        textarea.style.display = "";
        if (textarea.form) {
          off(textarea.form, "submit", save);
          if (typeof textarea.form.submit == "function")
            textarea.form.submit = realSubmit;
        }
      };
    };

    textarea.style.display = "none";
    var cm = CodeMirror(function(node) {
      textarea.parentNode.insertBefore(node, textarea.nextSibling);
    }, options);
    return cm;
  };

  // STRING STREAM

  // Fed to the mode parsers, provides helper functions to make
  // parsers more succinct.

  var StringStream = CodeMirror.StringStream = function(string, tabSize) {
    this.pos = this.start = 0;
    this.string = string;
    this.tabSize = tabSize || 8;
    this.lastColumnPos = this.lastColumnValue = 0;
    this.lineStart = 0;
  };

  StringStream.prototype = {
    eol: function() {return this.pos >= this.string.length;},
    sol: function() {return this.pos == this.lineStart;},
    peek: function() {return this.string.charAt(this.pos) || undefined;},
    next: function() {
      if (this.pos < this.string.length)
        return this.string.charAt(this.pos++);
    },
    eat: function(match) {
      var ch = this.string.charAt(this.pos);
      if (typeof match == "string") var ok = ch == match;
      else var ok = ch && (match.test ? match.test(ch) : match(ch));
      if (ok) {++this.pos; return ch;}
    },
    eatWhile: function(match) {
      var start = this.pos;
      while (this.eat(match)){}
      return this.pos > start;
    },
    eatSpace: function() {
      var start = this.pos;
      while (/[\s\u00a0]/.test(this.string.charAt(this.pos))) ++this.pos;
      return this.pos > start;
    },
    skipToEnd: function() {this.pos = this.string.length;},
    skipTo: function(ch) {
      var found = this.string.indexOf(ch, this.pos);
      if (found > -1) {this.pos = found; return true;}
    },
    backUp: function(n) {this.pos -= n;},
    column: function() {
      if (this.lastColumnPos < this.start) {
        this.lastColumnValue = countColumn(this.string, this.start, this.tabSize, this.lastColumnPos, this.lastColumnValue);
        this.lastColumnPos = this.start;
      }
      return this.lastColumnValue - (this.lineStart ? countColumn(this.string, this.lineStart, this.tabSize) : 0);
    },
    indentation: function() {
      return countColumn(this.string, null, this.tabSize) -
        (this.lineStart ? countColumn(this.string, this.lineStart, this.tabSize) : 0);
    },
    match: function(pattern, consume, caseInsensitive) {
      if (typeof pattern == "string") {
        var cased = function(str) {return caseInsensitive ? str.toLowerCase() : str;};
        var substr = this.string.substr(this.pos, pattern.length);
        if (cased(substr) == cased(pattern)) {
          if (consume !== false) this.pos += pattern.length;
          return true;
        }
      } else {
        var match = this.string.slice(this.pos).match(pattern);
        if (match && match.index > 0) return null;
        if (match && consume !== false) this.pos += match[0].length;
        return match;
      }
    },
    current: function(){return this.string.slice(this.start, this.pos);},
    hideFirstChars: function(n, inner) {
      this.lineStart += n;
      try { return inner(); }
      finally { this.lineStart -= n; }
    }
  };

  // TEXTMARKERS

  // Created with markText and setBookmark methods. A TextMarker is a
  // handle that can be used to clear or find a marked position in the
  // document. Line objects hold arrays (markedSpans) containing
  // {from, to, marker} object pointing to such marker objects, and
  // indicating that such a marker is present on that line. Multiple
  // lines may point to the same marker when it spans across lines.
  // The spans will have null for their from/to properties when the
  // marker continues beyond the start/end of the line. Markers have
  // links back to the lines they currently touch.

  var nextMarkerId = 0;

  var TextMarker = CodeMirror.TextMarker = function(doc, type) {
    this.lines = [];
    this.type = type;
    this.doc = doc;
    this.id = ++nextMarkerId;
  };
  eventMixin(TextMarker);

  // Clear the marker.
  TextMarker.prototype.clear = function() {
    if (this.explicitlyCleared) return;
    var cm = this.doc.cm, withOp = cm && !cm.curOp;
    if (withOp) startOperation(cm);
    if (hasHandler(this, "clear")) {
      var found = this.find();
      if (found) signalLater(this, "clear", found.from, found.to);
    }
    var min = null, max = null;
    for (var i = 0; i < this.lines.length; ++i) {
      var line = this.lines[i];
      var span = getMarkedSpanFor(line.markedSpans, this);
      if (cm && !this.collapsed) regLineChange(cm, lineNo(line), "text");
      else if (cm) {
        if (span.to != null) max = lineNo(line);
        if (span.from != null) min = lineNo(line);
      }
      line.markedSpans = removeMarkedSpan(line.markedSpans, span);
      if (span.from == null && this.collapsed && !lineIsHidden(this.doc, line) && cm)
        updateLineHeight(line, textHeight(cm.display));
    }
    if (cm && this.collapsed && !cm.options.lineWrapping) for (var i = 0; i < this.lines.length; ++i) {
      var visual = visualLine(this.lines[i]), len = lineLength(visual);
      if (len > cm.display.maxLineLength) {
        cm.display.maxLine = visual;
        cm.display.maxLineLength = len;
        cm.display.maxLineChanged = true;
      }
    }

    if (min != null && cm && this.collapsed) regChange(cm, min, max + 1);
    this.lines.length = 0;
    this.explicitlyCleared = true;
    if (this.atomic && this.doc.cantEdit) {
      this.doc.cantEdit = false;
      if (cm) reCheckSelection(cm.doc);
    }
    if (cm) signalLater(cm, "markerCleared", cm, this);
    if (withOp) endOperation(cm);
    if (this.parent) this.parent.clear();
  };

  // Find the position of the marker in the document. Returns a {from,
  // to} object by default. Side can be passed to get a specific side
  // -- 0 (both), -1 (left), or 1 (right). When lineObj is true, the
  // Pos objects returned contain a line object, rather than a line
  // number (used to prevent looking up the same line twice).
  TextMarker.prototype.find = function(side, lineObj) {
    if (side == null && this.type == "bookmark") side = 1;
    var from, to;
    for (var i = 0; i < this.lines.length; ++i) {
      var line = this.lines[i];
      var span = getMarkedSpanFor(line.markedSpans, this);
      if (span.from != null) {
        from = Pos(lineObj ? line : lineNo(line), span.from);
        if (side == -1) return from;
      }
      if (span.to != null) {
        to = Pos(lineObj ? line : lineNo(line), span.to);
        if (side == 1) return to;
      }
    }
    return from && {from: from, to: to};
  };

  // Signals that the marker's widget changed, and surrounding layout
  // should be recomputed.
  TextMarker.prototype.changed = function() {
    var pos = this.find(-1, true), widget = this, cm = this.doc.cm;
    if (!pos || !cm) return;
    runInOp(cm, function() {
      var line = pos.line, lineN = lineNo(pos.line);
      var view = findViewForLine(cm, lineN);
      if (view) {
        clearLineMeasurementCacheFor(view);
        cm.curOp.selectionChanged = cm.curOp.forceUpdate = true;
      }
      cm.curOp.updateMaxLine = true;
      if (!lineIsHidden(widget.doc, line) && widget.height != null) {
        var oldHeight = widget.height;
        widget.height = null;
        var dHeight = widgetHeight(widget) - oldHeight;
        if (dHeight)
          updateLineHeight(line, line.height + dHeight);
      }
    });
  };

  TextMarker.prototype.attachLine = function(line) {
    if (!this.lines.length && this.doc.cm) {
      var op = this.doc.cm.curOp;
      if (!op.maybeHiddenMarkers || indexOf(op.maybeHiddenMarkers, this) == -1)
        (op.maybeUnhiddenMarkers || (op.maybeUnhiddenMarkers = [])).push(this);
    }
    this.lines.push(line);
  };
  TextMarker.prototype.detachLine = function(line) {
    this.lines.splice(indexOf(this.lines, line), 1);
    if (!this.lines.length && this.doc.cm) {
      var op = this.doc.cm.curOp;
      (op.maybeHiddenMarkers || (op.maybeHiddenMarkers = [])).push(this);
    }
  };

  // Collapsed markers have unique ids, in order to be able to order
  // them, which is needed for uniquely determining an outer marker
  // when they overlap (they may nest, but not partially overlap).
  var nextMarkerId = 0;

  // Create a marker, wire it up to the right lines, and
  function markText(doc, from, to, options, type) {
    // Shared markers (across linked documents) are handled separately
    // (markTextShared will call out to this again, once per
    // document).
    if (options && options.shared) return markTextShared(doc, from, to, options, type);
    // Ensure we are in an operation.
    if (doc.cm && !doc.cm.curOp) return operation(doc.cm, markText)(doc, from, to, options, type);

    var marker = new TextMarker(doc, type), diff = cmp(from, to);
    if (options) copyObj(options, marker, false);
    // Don't connect empty markers unless clearWhenEmpty is false
    if (diff > 0 || diff == 0 && marker.clearWhenEmpty !== false)
      return marker;
    if (marker.replacedWith) {
      // Showing up as a widget implies collapsed (widget replaces text)
      marker.collapsed = true;
      marker.widgetNode = elt("span", [marker.replacedWith], "CodeMirror-widget");
      if (!options.handleMouseEvents) marker.widgetNode.setAttribute("cm-ignore-events", "true");
      if (options.insertLeft) marker.widgetNode.insertLeft = true;
    }
    if (marker.collapsed) {
      if (conflictingCollapsedRange(doc, from.line, from, to, marker) ||
          from.line != to.line && conflictingCollapsedRange(doc, to.line, from, to, marker))
        throw new Error("Inserting collapsed marker partially overlapping an existing one");
      sawCollapsedSpans = true;
    }

    if (marker.addToHistory)
      addChangeToHistory(doc, {from: from, to: to, origin: "markText"}, doc.sel, NaN);

    var curLine = from.line, cm = doc.cm, updateMaxLine;
    doc.iter(curLine, to.line + 1, function(line) {
      if (cm && marker.collapsed && !cm.options.lineWrapping && visualLine(line) == cm.display.maxLine)
        updateMaxLine = true;
      if (marker.collapsed && curLine != from.line) updateLineHeight(line, 0);
      addMarkedSpan(line, new MarkedSpan(marker,
                                         curLine == from.line ? from.ch : null,
                                         curLine == to.line ? to.ch : null));
      ++curLine;
    });
    // lineIsHidden depends on the presence of the spans, so needs a second pass
    if (marker.collapsed) doc.iter(from.line, to.line + 1, function(line) {
      if (lineIsHidden(doc, line)) updateLineHeight(line, 0);
    });

    if (marker.clearOnEnter) on(marker, "beforeCursorEnter", function() { marker.clear(); });

    if (marker.readOnly) {
      sawReadOnlySpans = true;
      if (doc.history.done.length || doc.history.undone.length)
        doc.clearHistory();
    }
    if (marker.collapsed) {
      marker.id = ++nextMarkerId;
      marker.atomic = true;
    }
    if (cm) {
      // Sync editor state
      if (updateMaxLine) cm.curOp.updateMaxLine = true;
      if (marker.collapsed)
        regChange(cm, from.line, to.line + 1);
      else if (marker.className || marker.title || marker.startStyle || marker.endStyle || marker.css)
        for (var i = from.line; i <= to.line; i++) regLineChange(cm, i, "text");
      if (marker.atomic) reCheckSelection(cm.doc);
      signalLater(cm, "markerAdded", cm, marker);
    }
    return marker;
  }

  // SHARED TEXTMARKERS

  // A shared marker spans multiple linked documents. It is
  // implemented as a meta-marker-object controlling multiple normal
  // markers.
  var SharedTextMarker = CodeMirror.SharedTextMarker = function(markers, primary) {
    this.markers = markers;
    this.primary = primary;
    for (var i = 0; i < markers.length; ++i)
      markers[i].parent = this;
  };
  eventMixin(SharedTextMarker);

  SharedTextMarker.prototype.clear = function() {
    if (this.explicitlyCleared) return;
    this.explicitlyCleared = true;
    for (var i = 0; i < this.markers.length; ++i)
      this.markers[i].clear();
    signalLater(this, "clear");
  };
  SharedTextMarker.prototype.find = function(side, lineObj) {
    return this.primary.find(side, lineObj);
  };

  function markTextShared(doc, from, to, options, type) {
    options = copyObj(options);
    options.shared = false;
    var markers = [markText(doc, from, to, options, type)], primary = markers[0];
    var widget = options.widgetNode;
    linkedDocs(doc, function(doc) {
      if (widget) options.widgetNode = widget.cloneNode(true);
      markers.push(markText(doc, clipPos(doc, from), clipPos(doc, to), options, type));
      for (var i = 0; i < doc.linked.length; ++i)
        if (doc.linked[i].isParent) return;
      primary = lst(markers);
    });
    return new SharedTextMarker(markers, primary);
  }

  function findSharedMarkers(doc) {
    return doc.findMarks(Pos(doc.first, 0), doc.clipPos(Pos(doc.lastLine())),
                         function(m) { return m.parent; });
  }

  function copySharedMarkers(doc, markers) {
    for (var i = 0; i < markers.length; i++) {
      var marker = markers[i], pos = marker.find();
      var mFrom = doc.clipPos(pos.from), mTo = doc.clipPos(pos.to);
      if (cmp(mFrom, mTo)) {
        var subMark = markText(doc, mFrom, mTo, marker.primary, marker.primary.type);
        marker.markers.push(subMark);
        subMark.parent = marker;
      }
    }
  }

  function detachSharedMarkers(markers) {
    for (var i = 0; i < markers.length; i++) {
      var marker = markers[i], linked = [marker.primary.doc];;
      linkedDocs(marker.primary.doc, function(d) { linked.push(d); });
      for (var j = 0; j < marker.markers.length; j++) {
        var subMarker = marker.markers[j];
        if (indexOf(linked, subMarker.doc) == -1) {
          subMarker.parent = null;
          marker.markers.splice(j--, 1);
        }
      }
    }
  }

  // TEXTMARKER SPANS

  function MarkedSpan(marker, from, to) {
    this.marker = marker;
    this.from = from; this.to = to;
  }

  // Search an array of spans for a span matching the given marker.
  function getMarkedSpanFor(spans, marker) {
    if (spans) for (var i = 0; i < spans.length; ++i) {
      var span = spans[i];
      if (span.marker == marker) return span;
    }
  }
  // Remove a span from an array, returning undefined if no spans are
  // left (we don't store arrays for lines without spans).
  function removeMarkedSpan(spans, span) {
    for (var r, i = 0; i < spans.length; ++i)
      if (spans[i] != span) (r || (r = [])).push(spans[i]);
    return r;
  }
  // Add a span to a line.
  function addMarkedSpan(line, span) {
    line.markedSpans = line.markedSpans ? line.markedSpans.concat([span]) : [span];
    span.marker.attachLine(line);
  }

  // Used for the algorithm that adjusts markers for a change in the
  // document. These functions cut an array of spans at a given
  // character position, returning an array of remaining chunks (or
  // undefined if nothing remains).
  function markedSpansBefore(old, startCh, isInsert) {
    if (old) for (var i = 0, nw; i < old.length; ++i) {
      var span = old[i], marker = span.marker;
      var startsBefore = span.from == null || (marker.inclusiveLeft ? span.from <= startCh : span.from < startCh);
      if (startsBefore || span.from == startCh && marker.type == "bookmark" && (!isInsert || !span.marker.insertLeft)) {
        var endsAfter = span.to == null || (marker.inclusiveRight ? span.to >= startCh : span.to > startCh);
        (nw || (nw = [])).push(new MarkedSpan(marker, span.from, endsAfter ? null : span.to));
      }
    }
    return nw;
  }
  function markedSpansAfter(old, endCh, isInsert) {
    if (old) for (var i = 0, nw; i < old.length; ++i) {
      var span = old[i], marker = span.marker;
      var endsAfter = span.to == null || (marker.inclusiveRight ? span.to >= endCh : span.to > endCh);
      if (endsAfter || span.from == endCh && marker.type == "bookmark" && (!isInsert || span.marker.insertLeft)) {
        var startsBefore = span.from == null || (marker.inclusiveLeft ? span.from <= endCh : span.from < endCh);
        (nw || (nw = [])).push(new MarkedSpan(marker, startsBefore ? null : span.from - endCh,
                                              span.to == null ? null : span.to - endCh));
      }
    }
    return nw;
  }

  // Given a change object, compute the new set of marker spans that
  // cover the line in which the change took place. Removes spans
  // entirely within the change, reconnects spans belonging to the
  // same marker that appear on both sides of the change, and cuts off
  // spans partially within the change. Returns an array of span
  // arrays with one element for each line in (after) the change.
  function stretchSpansOverChange(doc, change) {
    if (change.full) return null;
    var oldFirst = isLine(doc, change.from.line) && getLine(doc, change.from.line).markedSpans;
    var oldLast = isLine(doc, change.to.line) && getLine(doc, change.to.line).markedSpans;
    if (!oldFirst && !oldLast) return null;

    var startCh = change.from.ch, endCh = change.to.ch, isInsert = cmp(change.from, change.to) == 0;
    // Get the spans that 'stick out' on both sides
    var first = markedSpansBefore(oldFirst, startCh, isInsert);
    var last = markedSpansAfter(oldLast, endCh, isInsert);

    // Next, merge those two ends
    var sameLine = change.text.length == 1, offset = lst(change.text).length + (sameLine ? startCh : 0);
    if (first) {
      // Fix up .to properties of first
      for (var i = 0; i < first.length; ++i) {
        var span = first[i];
        if (span.to == null) {
          var found = getMarkedSpanFor(last, span.marker);
          if (!found) span.to = startCh;
          else if (sameLine) span.to = found.to == null ? null : found.to + offset;
        }
      }
    }
    if (last) {
      // Fix up .from in last (or move them into first in case of sameLine)
      for (var i = 0; i < last.length; ++i) {
        var span = last[i];
        if (span.to != null) span.to += offset;
        if (span.from == null) {
          var found = getMarkedSpanFor(first, span.marker);
          if (!found) {
            span.from = offset;
            if (sameLine) (first || (first = [])).push(span);
          }
        } else {
          span.from += offset;
          if (sameLine) (first || (first = [])).push(span);
        }
      }
    }
    // Make sure we didn't create any zero-length spans
    if (first) first = clearEmptySpans(first);
    if (last && last != first) last = clearEmptySpans(last);

    var newMarkers = [first];
    if (!sameLine) {
      // Fill gap with whole-line-spans
      var gap = change.text.length - 2, gapMarkers;
      if (gap > 0 && first)
        for (var i = 0; i < first.length; ++i)
          if (first[i].to == null)
            (gapMarkers || (gapMarkers = [])).push(new MarkedSpan(first[i].marker, null, null));
      for (var i = 0; i < gap; ++i)
        newMarkers.push(gapMarkers);
      newMarkers.push(last);
    }
    return newMarkers;
  }

  // Remove spans that are empty and don't have a clearWhenEmpty
  // option of false.
  function clearEmptySpans(spans) {
    for (var i = 0; i < spans.length; ++i) {
      var span = spans[i];
      if (span.from != null && span.from == span.to && span.marker.clearWhenEmpty !== false)
        spans.splice(i--, 1);
    }
    if (!spans.length) return null;
    return spans;
  }

  // Used for un/re-doing changes from the history. Combines the
  // result of computing the existing spans with the set of spans that
  // existed in the history (so that deleting around a span and then
  // undoing brings back the span).
  function mergeOldSpans(doc, change) {
    var old = getOldSpans(doc, change);
    var stretched = stretchSpansOverChange(doc, change);
    if (!old) return stretched;
    if (!stretched) return old;

    for (var i = 0; i < old.length; ++i) {
      var oldCur = old[i], stretchCur = stretched[i];
      if (oldCur && stretchCur) {
        spans: for (var j = 0; j < stretchCur.length; ++j) {
          var span = stretchCur[j];
          for (var k = 0; k < oldCur.length; ++k)
            if (oldCur[k].marker == span.marker) continue spans;
          oldCur.push(span);
        }
      } else if (stretchCur) {
        old[i] = stretchCur;
      }
    }
    return old;
  }

  // Used to 'clip' out readOnly ranges when making a change.
  function removeReadOnlyRanges(doc, from, to) {
    var markers = null;
    doc.iter(from.line, to.line + 1, function(line) {
      if (line.markedSpans) for (var i = 0; i < line.markedSpans.length; ++i) {
        var mark = line.markedSpans[i].marker;
        if (mark.readOnly && (!markers || indexOf(markers, mark) == -1))
          (markers || (markers = [])).push(mark);
      }
    });
    if (!markers) return null;
    var parts = [{from: from, to: to}];
    for (var i = 0; i < markers.length; ++i) {
      var mk = markers[i], m = mk.find(0);
      for (var j = 0; j < parts.length; ++j) {
        var p = parts[j];
        if (cmp(p.to, m.from) < 0 || cmp(p.from, m.to) > 0) continue;
        var newParts = [j, 1], dfrom = cmp(p.from, m.from), dto = cmp(p.to, m.to);
        if (dfrom < 0 || !mk.inclusiveLeft && !dfrom)
          newParts.push({from: p.from, to: m.from});
        if (dto > 0 || !mk.inclusiveRight && !dto)
          newParts.push({from: m.to, to: p.to});
        parts.splice.apply(parts, newParts);
        j += newParts.length - 1;
      }
    }
    return parts;
  }

  // Connect or disconnect spans from a line.
  function detachMarkedSpans(line) {
    var spans = line.markedSpans;
    if (!spans) return;
    for (var i = 0; i < spans.length; ++i)
      spans[i].marker.detachLine(line);
    line.markedSpans = null;
  }
  function attachMarkedSpans(line, spans) {
    if (!spans) return;
    for (var i = 0; i < spans.length; ++i)
      spans[i].marker.attachLine(line);
    line.markedSpans = spans;
  }

  // Helpers used when computing which overlapping collapsed span
  // counts as the larger one.
  function extraLeft(marker) { return marker.inclusiveLeft ? -1 : 0; }
  function extraRight(marker) { return marker.inclusiveRight ? 1 : 0; }

  // Returns a number indicating which of two overlapping collapsed
  // spans is larger (and thus includes the other). Falls back to
  // comparing ids when the spans cover exactly the same range.
  function compareCollapsedMarkers(a, b) {
    var lenDiff = a.lines.length - b.lines.length;
    if (lenDiff != 0) return lenDiff;
    var aPos = a.find(), bPos = b.find();
    var fromCmp = cmp(aPos.from, bPos.from) || extraLeft(a) - extraLeft(b);
    if (fromCmp) return -fromCmp;
    var toCmp = cmp(aPos.to, bPos.to) || extraRight(a) - extraRight(b);
    if (toCmp) return toCmp;
    return b.id - a.id;
  }

  // Find out whether a line ends or starts in a collapsed span. If
  // so, return the marker for that span.
  function collapsedSpanAtSide(line, start) {
    var sps = sawCollapsedSpans && line.markedSpans, found;
    if (sps) for (var sp, i = 0; i < sps.length; ++i) {
      sp = sps[i];
      if (sp.marker.collapsed && (start ? sp.from : sp.to) == null &&
          (!found || compareCollapsedMarkers(found, sp.marker) < 0))
        found = sp.marker;
    }
    return found;
  }
  function collapsedSpanAtStart(line) { return collapsedSpanAtSide(line, true); }
  function collapsedSpanAtEnd(line) { return collapsedSpanAtSide(line, false); }

  // Test whether there exists a collapsed span that partially
  // overlaps (covers the start or end, but not both) of a new span.
  // Such overlap is not allowed.
  function conflictingCollapsedRange(doc, lineNo, from, to, marker) {
    var line = getLine(doc, lineNo);
    var sps = sawCollapsedSpans && line.markedSpans;
    if (sps) for (var i = 0; i < sps.length; ++i) {
      var sp = sps[i];
      if (!sp.marker.collapsed) continue;
      var found = sp.marker.find(0);
      var fromCmp = cmp(found.from, from) || extraLeft(sp.marker) - extraLeft(marker);
      var toCmp = cmp(found.to, to) || extraRight(sp.marker) - extraRight(marker);
      if (fromCmp >= 0 && toCmp <= 0 || fromCmp <= 0 && toCmp >= 0) continue;
      if (fromCmp <= 0 && (cmp(found.to, from) > 0 || (sp.marker.inclusiveRight && marker.inclusiveLeft)) ||
          fromCmp >= 0 && (cmp(found.from, to) < 0 || (sp.marker.inclusiveLeft && marker.inclusiveRight)))
        return true;
    }
  }

  // A visual line is a line as drawn on the screen. Folding, for
  // example, can cause multiple logical lines to appear on the same
  // visual line. This finds the start of the visual line that the
  // given line is part of (usually that is the line itself).
  function visualLine(line) {
    var merged;
    while (merged = collapsedSpanAtStart(line))
      line = merged.find(-1, true).line;
    return line;
  }

  // Returns an array of logical lines that continue the visual line
  // started by the argument, or undefined if there are no such lines.
  function visualLineContinued(line) {
    var merged, lines;
    while (merged = collapsedSpanAtEnd(line)) {
      line = merged.find(1, true).line;
      (lines || (lines = [])).push(line);
    }
    return lines;
  }

  // Get the line number of the start of the visual line that the
  // given line number is part of.
  function visualLineNo(doc, lineN) {
    var line = getLine(doc, lineN), vis = visualLine(line);
    if (line == vis) return lineN;
    return lineNo(vis);
  }
  // Get the line number of the start of the next visual line after
  // the given line.
  function visualLineEndNo(doc, lineN) {
    if (lineN > doc.lastLine()) return lineN;
    var line = getLine(doc, lineN), merged;
    if (!lineIsHidden(doc, line)) return lineN;
    while (merged = collapsedSpanAtEnd(line))
      line = merged.find(1, true).line;
    return lineNo(line) + 1;
  }

  // Compute whether a line is hidden. Lines count as hidden when they
  // are part of a visual line that starts with another line, or when
  // they are entirely covered by collapsed, non-widget span.
  function lineIsHidden(doc, line) {
    var sps = sawCollapsedSpans && line.markedSpans;
    if (sps) for (var sp, i = 0; i < sps.length; ++i) {
      sp = sps[i];
      if (!sp.marker.collapsed) continue;
      if (sp.from == null) return true;
      if (sp.marker.widgetNode) continue;
      if (sp.from == 0 && sp.marker.inclusiveLeft && lineIsHiddenInner(doc, line, sp))
        return true;
    }
  }
  function lineIsHiddenInner(doc, line, span) {
    if (span.to == null) {
      var end = span.marker.find(1, true);
      return lineIsHiddenInner(doc, end.line, getMarkedSpanFor(end.line.markedSpans, span.marker));
    }
    if (span.marker.inclusiveRight && span.to == line.text.length)
      return true;
    for (var sp, i = 0; i < line.markedSpans.length; ++i) {
      sp = line.markedSpans[i];
      if (sp.marker.collapsed && !sp.marker.widgetNode && sp.from == span.to &&
          (sp.to == null || sp.to != span.from) &&
          (sp.marker.inclusiveLeft || span.marker.inclusiveRight) &&
          lineIsHiddenInner(doc, line, sp)) return true;
    }
  }

  // LINE WIDGETS

  // Line widgets are block elements displayed above or below a line.

  var LineWidget = CodeMirror.LineWidget = function(doc, node, options) {
    if (options) for (var opt in options) if (options.hasOwnProperty(opt))
      this[opt] = options[opt];
    this.doc = doc;
    this.node = node;
  };
  eventMixin(LineWidget);

  function adjustScrollWhenAboveVisible(cm, line, diff) {
    if (heightAtLine(line) < ((cm.curOp && cm.curOp.scrollTop) || cm.doc.scrollTop))
      addToScrollPos(cm, null, diff);
  }

  LineWidget.prototype.clear = function() {
    var cm = this.doc.cm, ws = this.line.widgets, line = this.line, no = lineNo(line);
    if (no == null || !ws) return;
    for (var i = 0; i < ws.length; ++i) if (ws[i] == this) ws.splice(i--, 1);
    if (!ws.length) line.widgets = null;
    var height = widgetHeight(this);
    updateLineHeight(line, Math.max(0, line.height - height));
    if (cm) runInOp(cm, function() {
      adjustScrollWhenAboveVisible(cm, line, -height);
      regLineChange(cm, no, "widget");
    });
  };
  LineWidget.prototype.changed = function() {
    var oldH = this.height, cm = this.doc.cm, line = this.line;
    this.height = null;
    var diff = widgetHeight(this) - oldH;
    if (!diff) return;
    updateLineHeight(line, line.height + diff);
    if (cm) runInOp(cm, function() {
      cm.curOp.forceUpdate = true;
      adjustScrollWhenAboveVisible(cm, line, diff);
    });
  };

  function widgetHeight(widget) {
    if (widget.height != null) return widget.height;
    var cm = widget.doc.cm;
    if (!cm) return 0;
    if (!contains(document.body, widget.node)) {
      var parentStyle = "position: relative;";
      if (widget.coverGutter)
        parentStyle += "margin-left: -" + cm.display.gutters.offsetWidth + "px;";
      if (widget.noHScroll)
        parentStyle += "width: " + cm.display.wrapper.clientWidth + "px;";
      removeChildrenAndAdd(cm.display.measure, elt("div", [widget.node], null, parentStyle));
    }
    return widget.height = widget.node.offsetHeight;
  }

  function addLineWidget(doc, handle, node, options) {
    var widget = new LineWidget(doc, node, options);
    var cm = doc.cm;
    if (cm && widget.noHScroll) cm.display.alignWidgets = true;
    changeLine(doc, handle, "widget", function(line) {
      var widgets = line.widgets || (line.widgets = []);
      if (widget.insertAt == null) widgets.push(widget);
      else widgets.splice(Math.min(widgets.length - 1, Math.max(0, widget.insertAt)), 0, widget);
      widget.line = line;
      if (cm && !lineIsHidden(doc, line)) {
        var aboveVisible = heightAtLine(line) < doc.scrollTop;
        updateLineHeight(line, line.height + widgetHeight(widget));
        if (aboveVisible) addToScrollPos(cm, null, widget.height);
        cm.curOp.forceUpdate = true;
      }
      return true;
    });
    return widget;
  }

  // LINE DATA STRUCTURE

  // Line objects. These hold state related to a line, including
  // highlighting info (the styles array).
  var Line = CodeMirror.Line = function(text, markedSpans, estimateHeight) {
    this.text = text;
    attachMarkedSpans(this, markedSpans);
    this.height = estimateHeight ? estimateHeight(this) : 1;
  };
  eventMixin(Line);
  Line.prototype.lineNo = function() { return lineNo(this); };

  // Change the content (text, markers) of a line. Automatically
  // invalidates cached information and tries to re-estimate the
  // line's height.
  function updateLine(line, text, markedSpans, estimateHeight) {
    line.text = text;
    if (line.stateAfter) line.stateAfter = null;
    if (line.styles) line.styles = null;
    if (line.order != null) line.order = null;
    detachMarkedSpans(line);
    attachMarkedSpans(line, markedSpans);
    var estHeight = estimateHeight ? estimateHeight(line) : 1;
    if (estHeight != line.height) updateLineHeight(line, estHeight);
  }

  // Detach a line from the document tree and its markers.
  function cleanUpLine(line) {
    line.parent = null;
    detachMarkedSpans(line);
  }

  function extractLineClasses(type, output) {
    if (type) for (;;) {
      var lineClass = type.match(/(?:^|\s+)line-(background-)?(\S+)/);
      if (!lineClass) break;
      type = type.slice(0, lineClass.index) + type.slice(lineClass.index + lineClass[0].length);
      var prop = lineClass[1] ? "bgClass" : "textClass";
      if (output[prop] == null)
        output[prop] = lineClass[2];
      else if (!(new RegExp("(?:^|\s)" + lineClass[2] + "(?:$|\s)")).test(output[prop]))
        output[prop] += " " + lineClass[2];
    }
    return type;
  }

  function callBlankLine(mode, state) {
    if (mode.blankLine) return mode.blankLine(state);
    if (!mode.innerMode) return;
    var inner = CodeMirror.innerMode(mode, state);
    if (inner.mode.blankLine) return inner.mode.blankLine(inner.state);
  }

  function readToken(mode, stream, state, inner) {
    for (var i = 0; i < 10; i++) {
      if (inner) inner[0] = CodeMirror.innerMode(mode, state).mode;
      var style = mode.token(stream, state);
      if (stream.pos > stream.start) return style;
    }
    throw new Error("Mode " + mode.name + " failed to advance stream.");
  }

  // Utility for getTokenAt and getLineTokens
  function takeToken(cm, pos, precise, asArray) {
    function getObj(copy) {
      return {start: stream.start, end: stream.pos,
              string: stream.current(),
              type: style || null,
              state: copy ? copyState(doc.mode, state) : state};
    }

    var doc = cm.doc, mode = doc.mode, style;
    pos = clipPos(doc, pos);
    var line = getLine(doc, pos.line), state = getStateBefore(cm, pos.line, precise);
    var stream = new StringStream(line.text, cm.options.tabSize), tokens;
    if (asArray) tokens = [];
    while ((asArray || stream.pos < pos.ch) && !stream.eol()) {
      stream.start = stream.pos;
      style = readToken(mode, stream, state);
      if (asArray) tokens.push(getObj(true));
    }
    return asArray ? tokens : getObj();
  }

  // Run the given mode's parser over a line, calling f for each token.
  function runMode(cm, text, mode, state, f, lineClasses, forceToEnd) {
    var flattenSpans = mode.flattenSpans;
    if (flattenSpans == null) flattenSpans = cm.options.flattenSpans;
    var curStart = 0, curStyle = null;
    var stream = new StringStream(text, cm.options.tabSize), style;
    var inner = cm.options.addModeClass && [null];
    if (text == "") extractLineClasses(callBlankLine(mode, state), lineClasses);
    while (!stream.eol()) {
      if (stream.pos > cm.options.maxHighlightLength) {
        flattenSpans = false;
        if (forceToEnd) processLine(cm, text, state, stream.pos);
        stream.pos = text.length;
        style = null;
      } else {
        style = extractLineClasses(readToken(mode, stream, state, inner), lineClasses);
      }
      if (inner) {
        var mName = inner[0].name;
        if (mName) style = "m-" + (style ? mName + " " + style : mName);
      }
      if (!flattenSpans || curStyle != style) {
        while (curStart < stream.start) {
          curStart = Math.min(stream.start, curStart + 50000);
          f(curStart, curStyle);
        }
        curStyle = style;
      }
      stream.start = stream.pos;
    }
    while (curStart < stream.pos) {
      // Webkit seems to refuse to render text nodes longer than 57444 characters
      var pos = Math.min(stream.pos, curStart + 50000);
      f(pos, curStyle);
      curStart = pos;
    }
  }

  // Compute a style array (an array starting with a mode generation
  // -- for invalidation -- followed by pairs of end positions and
  // style strings), which is used to highlight the tokens on the
  // line.
  function highlightLine(cm, line, state, forceToEnd) {
    // A styles array always starts with a number identifying the
    // mode/overlays that it is based on (for easy invalidation).
    var st = [cm.state.modeGen], lineClasses = {};
    // Compute the base array of styles
    runMode(cm, line.text, cm.doc.mode, state, function(end, style) {
      st.push(end, style);
    }, lineClasses, forceToEnd);

    // Run overlays, adjust style array.
    for (var o = 0; o < cm.state.overlays.length; ++o) {
      var overlay = cm.state.overlays[o], i = 1, at = 0;
      runMode(cm, line.text, overlay.mode, true, function(end, style) {
        var start = i;
        // Ensure there's a token end at the current position, and that i points at it
        while (at < end) {
          var i_end = st[i];
          if (i_end > end)
            st.splice(i, 1, end, st[i+1], i_end);
          i += 2;
          at = Math.min(end, i_end);
        }
        if (!style) return;
        if (overlay.opaque) {
          st.splice(start, i - start, end, "cm-overlay " + style);
          i = start + 2;
        } else {
          for (; start < i; start += 2) {
            var cur = st[start+1];
            st[start+1] = (cur ? cur + " " : "") + "cm-overlay " + style;
          }
        }
      }, lineClasses);
    }

    return {styles: st, classes: lineClasses.bgClass || lineClasses.textClass ? lineClasses : null};
  }

  function getLineStyles(cm, line, updateFrontier) {
    if (!line.styles || line.styles[0] != cm.state.modeGen) {
      var state = getStateBefore(cm, lineNo(line));
      var result = highlightLine(cm, line, line.text.length > cm.options.maxHighlightLength ? copyState(cm.doc.mode, state) : state);
      line.stateAfter = state;
      line.styles = result.styles;
      if (result.classes) line.styleClasses = result.classes;
      else if (line.styleClasses) line.styleClasses = null;
      if (updateFrontier === cm.doc.frontier) cm.doc.frontier++;
    }
    return line.styles;
  }

  // Lightweight form of highlight -- proceed over this line and
  // update state, but don't save a style array. Used for lines that
  // aren't currently visible.
  function processLine(cm, text, state, startAt) {
    var mode = cm.doc.mode;
    var stream = new StringStream(text, cm.options.tabSize);
    stream.start = stream.pos = startAt || 0;
    if (text == "") callBlankLine(mode, state);
    while (!stream.eol()) {
      readToken(mode, stream, state);
      stream.start = stream.pos;
    }
  }

  // Convert a style as returned by a mode (either null, or a string
  // containing one or more styles) to a CSS style. This is cached,
  // and also looks for line-wide styles.
  var styleToClassCache = {}, styleToClassCacheWithMode = {};
  function interpretTokenStyle(style, options) {
    if (!style || /^\s*$/.test(style)) return null;
    var cache = options.addModeClass ? styleToClassCacheWithMode : styleToClassCache;
    return cache[style] ||
      (cache[style] = style.replace(/\S+/g, "cm-$&"));
  }

  // Render the DOM representation of the text of a line. Also builds
  // up a 'line map', which points at the DOM nodes that represent
  // specific stretches of text, and is used by the measuring code.
  // The returned object contains the DOM node, this map, and
  // information about line-wide styles that were set by the mode.
  function buildLineContent(cm, lineView) {
    // The padding-right forces the element to have a 'border', which
    // is needed on Webkit to be able to get line-level bounding
    // rectangles for it (in measureChar).
    var content = elt("span", null, null, webkit ? "padding-right: .1px" : null);
    var builder = {pre: elt("pre", [content], "CodeMirror-line"), content: content,
                   col: 0, pos: 0, cm: cm,
                   splitSpaces: (ie || webkit) && cm.getOption("lineWrapping")};
    lineView.measure = {};

    // Iterate over the logical lines that make up this visual line.
    for (var i = 0; i <= (lineView.rest ? lineView.rest.length : 0); i++) {
      var line = i ? lineView.rest[i - 1] : lineView.line, order;
      builder.pos = 0;
      builder.addToken = buildToken;
      // Optionally wire in some hacks into the token-rendering
      // algorithm, to deal with browser quirks.
      if (hasBadBidiRects(cm.display.measure) && (order = getOrder(line)))
        builder.addToken = buildTokenBadBidi(builder.addToken, order);
      builder.map = [];
      var allowFrontierUpdate = lineView != cm.display.externalMeasured && lineNo(line);
      insertLineContent(line, builder, getLineStyles(cm, line, allowFrontierUpdate));
      if (line.styleClasses) {
        if (line.styleClasses.bgClass)
          builder.bgClass = joinClasses(line.styleClasses.bgClass, builder.bgClass || "");
        if (line.styleClasses.textClass)
          builder.textClass = joinClasses(line.styleClasses.textClass, builder.textClass || "");
      }

      // Ensure at least a single node is present, for measuring.
      if (builder.map.length == 0)
        builder.map.push(0, 0, builder.content.appendChild(zeroWidthElement(cm.display.measure)));

      // Store the map and a cache object for the current logical line
      if (i == 0) {
        lineView.measure.map = builder.map;
        lineView.measure.cache = {};
      } else {
        (lineView.measure.maps || (lineView.measure.maps = [])).push(builder.map);
        (lineView.measure.caches || (lineView.measure.caches = [])).push({});
      }
    }

    // See issue #2901
    if (webkit && /\bcm-tab\b/.test(builder.content.lastChild.className))
      builder.content.className = "cm-tab-wrap-hack";

    signal(cm, "renderLine", cm, lineView.line, builder.pre);
    if (builder.pre.className)
      builder.textClass = joinClasses(builder.pre.className, builder.textClass || "");

    return builder;
  }

  function defaultSpecialCharPlaceholder(ch) {
    var token = elt("span", "\u2022", "cm-invalidchar");
    token.title = "\\u" + ch.charCodeAt(0).toString(16);
    token.setAttribute("aria-label", token.title);
    return token;
  }

  // Build up the DOM representation for a single token, and add it to
  // the line map. Takes care to render special characters separately.
  function buildToken(builder, text, style, startStyle, endStyle, title, css) {
    if (!text) return;
    var displayText = builder.splitSpaces ? text.replace(/ {3,}/g, splitSpaces) : text;
    var special = builder.cm.state.specialChars, mustWrap = false;
    if (!special.test(text)) {
      builder.col += text.length;
      var content = document.createTextNode(displayText);
      builder.map.push(builder.pos, builder.pos + text.length, content);
      if (ie && ie_version < 9) mustWrap = true;
      builder.pos += text.length;
    } else {
      var content = document.createDocumentFragment(), pos = 0;
      while (true) {
        special.lastIndex = pos;
        var m = special.exec(text);
        var skipped = m ? m.index - pos : text.length - pos;
        if (skipped) {
          var txt = document.createTextNode(displayText.slice(pos, pos + skipped));
          if (ie && ie_version < 9) content.appendChild(elt("span", [txt]));
          else content.appendChild(txt);
          builder.map.push(builder.pos, builder.pos + skipped, txt);
          builder.col += skipped;
          builder.pos += skipped;
        }
        if (!m) break;
        pos += skipped + 1;
        if (m[0] == "\t") {
          var tabSize = builder.cm.options.tabSize, tabWidth = tabSize - builder.col % tabSize;
          var txt = content.appendChild(elt("span", spaceStr(tabWidth), "cm-tab"));
          txt.setAttribute("role", "presentation");
          txt.setAttribute("cm-text", "\t");
          builder.col += tabWidth;
        } else if (m[0] == "\r" || m[0] == "\n") {
          var txt = content.appendChild(elt("span", m[0] == "\r" ? "\u240d" : "\u2424", "cm-invalidchar"));
          txt.setAttribute("cm-text", m[0]);
          builder.col += 1;
        } else {
          var txt = builder.cm.options.specialCharPlaceholder(m[0]);
          txt.setAttribute("cm-text", m[0]);
          if (ie && ie_version < 9) content.appendChild(elt("span", [txt]));
          else content.appendChild(txt);
          builder.col += 1;
        }
        builder.map.push(builder.pos, builder.pos + 1, txt);
        builder.pos++;
      }
    }
    if (style || startStyle || endStyle || mustWrap || css) {
      var fullStyle = style || "";
      if (startStyle) fullStyle += startStyle;
      if (endStyle) fullStyle += endStyle;
      var token = elt("span", [content], fullStyle, css);
      if (title) token.title = title;
      return builder.content.appendChild(token);
    }
    builder.content.appendChild(content);
  }

  function splitSpaces(old) {
    var out = " ";
    for (var i = 0; i < old.length - 2; ++i) out += i % 2 ? " " : "\u00a0";
    out += " ";
    return out;
  }

  // Work around nonsense dimensions being reported for stretches of
  // right-to-left text.
  function buildTokenBadBidi(inner, order) {
    return function(builder, text, style, startStyle, endStyle, title, css) {
      style = style ? style + " cm-force-border" : "cm-force-border";
      var start = builder.pos, end = start + text.length;
      for (;;) {
        // Find the part that overlaps with the start of this text
        for (var i = 0; i < order.length; i++) {
          var part = order[i];
          if (part.to > start && part.from <= start) break;
        }
        if (part.to >= end) return inner(builder, text, style, startStyle, endStyle, title, css);
        inner(builder, text.slice(0, part.to - start), style, startStyle, null, title, css);
        startStyle = null;
        text = text.slice(part.to - start);
        start = part.to;
      }
    };
  }

  function buildCollapsedSpan(builder, size, marker, ignoreWidget) {
    var widget = !ignoreWidget && marker.widgetNode;
    if (widget) builder.map.push(builder.pos, builder.pos + size, widget);
    if (!ignoreWidget && builder.cm.display.input.needsContentAttribute) {
      if (!widget)
        widget = builder.content.appendChild(document.createElement("span"));
      widget.setAttribute("cm-marker", marker.id);
    }
    if (widget) {
      builder.cm.display.input.setUneditable(widget);
      builder.content.appendChild(widget);
    }
    builder.pos += size;
  }

  // Outputs a number of spans to make up a line, taking highlighting
  // and marked text into account.
  function insertLineContent(line, builder, styles) {
    var spans = line.markedSpans, allText = line.text, at = 0;
    if (!spans) {
      for (var i = 1; i < styles.length; i+=2)
        builder.addToken(builder, allText.slice(at, at = styles[i]), interpretTokenStyle(styles[i+1], builder.cm.options));
      return;
    }

    var len = allText.length, pos = 0, i = 1, text = "", style, css;
    var nextChange = 0, spanStyle, spanEndStyle, spanStartStyle, title, collapsed;
    for (;;) {
      if (nextChange == pos) { // Update current marker set
        spanStyle = spanEndStyle = spanStartStyle = title = css = "";
        collapsed = null; nextChange = Infinity;
        var foundBookmarks = [];
        for (var j = 0; j < spans.length; ++j) {
          var sp = spans[j], m = sp.marker;
          if (m.type == "bookmark" && sp.from == pos && m.widgetNode) {
            foundBookmarks.push(m);
          } else if (sp.from <= pos && (sp.to == null || sp.to > pos || m.collapsed && sp.to == pos && sp.from == pos)) {
            if (sp.to != null && sp.to != pos && nextChange > sp.to) {
              nextChange = sp.to;
              spanEndStyle = "";
            }
            if (m.className) spanStyle += " " + m.className;
            if (m.css) css = m.css;
            if (m.startStyle && sp.from == pos) spanStartStyle += " " + m.startStyle;
            if (m.endStyle && sp.to == nextChange) spanEndStyle += " " + m.endStyle;
            if (m.title && !title) title = m.title;
            if (m.collapsed && (!collapsed || compareCollapsedMarkers(collapsed.marker, m) < 0))
              collapsed = sp;
          } else if (sp.from > pos && nextChange > sp.from) {
            nextChange = sp.from;
          }
        }
        if (collapsed && (collapsed.from || 0) == pos) {
          buildCollapsedSpan(builder, (collapsed.to == null ? len + 1 : collapsed.to) - pos,
                             collapsed.marker, collapsed.from == null);
          if (collapsed.to == null) return;
          if (collapsed.to == pos) collapsed = false;
        }
        if (!collapsed && foundBookmarks.length) for (var j = 0; j < foundBookmarks.length; ++j)
          buildCollapsedSpan(builder, 0, foundBookmarks[j]);
      }
      if (pos >= len) break;

      var upto = Math.min(len, nextChange);
      while (true) {
        if (text) {
          var end = pos + text.length;
          if (!collapsed) {
            var tokenText = end > upto ? text.slice(0, upto - pos) : text;
            builder.addToken(builder, tokenText, style ? style + spanStyle : spanStyle,
                             spanStartStyle, pos + tokenText.length == nextChange ? spanEndStyle : "", title, css);
          }
          if (end >= upto) {text = text.slice(upto - pos); pos = upto; break;}
          pos = end;
          spanStartStyle = "";
        }
        text = allText.slice(at, at = styles[i++]);
        style = interpretTokenStyle(styles[i++], builder.cm.options);
      }
    }
  }

  // DOCUMENT DATA STRUCTURE

  // By default, updates that start and end at the beginning of a line
  // are treated specially, in order to make the association of line
  // widgets and marker elements with the text behave more intuitive.
  function isWholeLineUpdate(doc, change) {
    return change.from.ch == 0 && change.to.ch == 0 && lst(change.text) == "" &&
      (!doc.cm || doc.cm.options.wholeLineUpdateBefore);
  }

  // Perform a change on the document data structure.
  function updateDoc(doc, change, markedSpans, estimateHeight) {
    function spansFor(n) {return markedSpans ? markedSpans[n] : null;}
    function update(line, text, spans) {
      updateLine(line, text, spans, estimateHeight);
      signalLater(line, "change", line, change);
    }
    function linesFor(start, end) {
      for (var i = start, result = []; i < end; ++i)
        result.push(new Line(text[i], spansFor(i), estimateHeight));
      return result;
    }

    var from = change.from, to = change.to, text = change.text;
    var firstLine = getLine(doc, from.line), lastLine = getLine(doc, to.line);
    var lastText = lst(text), lastSpans = spansFor(text.length - 1), nlines = to.line - from.line;

    // Adjust the line structure
    if (change.full) {
      doc.insert(0, linesFor(0, text.length));
      doc.remove(text.length, doc.size - text.length);
    } else if (isWholeLineUpdate(doc, change)) {
      // This is a whole-line replace. Treated specially to make
      // sure line objects move the way they are supposed to.
      var added = linesFor(0, text.length - 1);
      update(lastLine, lastLine.text, lastSpans);
      if (nlines) doc.remove(from.line, nlines);
      if (added.length) doc.insert(from.line, added);
    } else if (firstLine == lastLine) {
      if (text.length == 1) {
        update(firstLine, firstLine.text.slice(0, from.ch) + lastText + firstLine.text.slice(to.ch), lastSpans);
      } else {
        var added = linesFor(1, text.length - 1);
        added.push(new Line(lastText + firstLine.text.slice(to.ch), lastSpans, estimateHeight));
        update(firstLine, firstLine.text.slice(0, from.ch) + text[0], spansFor(0));
        doc.insert(from.line + 1, added);
      }
    } else if (text.length == 1) {
      update(firstLine, firstLine.text.slice(0, from.ch) + text[0] + lastLine.text.slice(to.ch), spansFor(0));
      doc.remove(from.line + 1, nlines);
    } else {
      update(firstLine, firstLine.text.slice(0, from.ch) + text[0], spansFor(0));
      update(lastLine, lastText + lastLine.text.slice(to.ch), lastSpans);
      var added = linesFor(1, text.length - 1);
      if (nlines > 1) doc.remove(from.line + 1, nlines - 1);
      doc.insert(from.line + 1, added);
    }

    signalLater(doc, "change", doc, change);
  }

  // The document is represented as a BTree consisting of leaves, with
  // chunk of lines in them, and branches, with up to ten leaves or
  // other branch nodes below them. The top node is always a branch
  // node, and is the document object itself (meaning it has
  // additional methods and properties).
  //
  // All nodes have parent links. The tree is used both to go from
  // line numbers to line objects, and to go from objects to numbers.
  // It also indexes by height, and is used to convert between height
  // and line object, and to find the total height of the document.
  //
  // See also http://marijnhaverbeke.nl/blog/codemirror-line-tree.html

  function LeafChunk(lines) {
    this.lines = lines;
    this.parent = null;
    for (var i = 0, height = 0; i < lines.length; ++i) {
      lines[i].parent = this;
      height += lines[i].height;
    }
    this.height = height;
  }

  LeafChunk.prototype = {
    chunkSize: function() { return this.lines.length; },
    // Remove the n lines at offset 'at'.
    removeInner: function(at, n) {
      for (var i = at, e = at + n; i < e; ++i) {
        var line = this.lines[i];
        this.height -= line.height;
        cleanUpLine(line);
        signalLater(line, "delete");
      }
      this.lines.splice(at, n);
    },
    // Helper used to collapse a small branch into a single leaf.
    collapse: function(lines) {
      lines.push.apply(lines, this.lines);
    },
    // Insert the given array of lines at offset 'at', count them as
    // having the given height.
    insertInner: function(at, lines, height) {
      this.height += height;
      this.lines = this.lines.slice(0, at).concat(lines).concat(this.lines.slice(at));
      for (var i = 0; i < lines.length; ++i) lines[i].parent = this;
    },
    // Used to iterate over a part of the tree.
    iterN: function(at, n, op) {
      for (var e = at + n; at < e; ++at)
        if (op(this.lines[at])) return true;
    }
  };

  function BranchChunk(children) {
    this.children = children;
    var size = 0, height = 0;
    for (var i = 0; i < children.length; ++i) {
      var ch = children[i];
      size += ch.chunkSize(); height += ch.height;
      ch.parent = this;
    }
    this.size = size;
    this.height = height;
    this.parent = null;
  }

  BranchChunk.prototype = {
    chunkSize: function() { return this.size; },
    removeInner: function(at, n) {
      this.size -= n;
      for (var i = 0; i < this.children.length; ++i) {
        var child = this.children[i], sz = child.chunkSize();
        if (at < sz) {
          var rm = Math.min(n, sz - at), oldHeight = child.height;
          child.removeInner(at, rm);
          this.height -= oldHeight - child.height;
          if (sz == rm) { this.children.splice(i--, 1); child.parent = null; }
          if ((n -= rm) == 0) break;
          at = 0;
        } else at -= sz;
      }
      // If the result is smaller than 25 lines, ensure that it is a
      // single leaf node.
      if (this.size - n < 25 &&
          (this.children.length > 1 || !(this.children[0] instanceof LeafChunk))) {
        var lines = [];
        this.collapse(lines);
        this.children = [new LeafChunk(lines)];
        this.children[0].parent = this;
      }
    },
    collapse: function(lines) {
      for (var i = 0; i < this.children.length; ++i) this.children[i].collapse(lines);
    },
    insertInner: function(at, lines, height) {
      this.size += lines.length;
      this.height += height;
      for (var i = 0; i < this.children.length; ++i) {
        var child = this.children[i], sz = child.chunkSize();
        if (at <= sz) {
          child.insertInner(at, lines, height);
          if (child.lines && child.lines.length > 50) {
            while (child.lines.length > 50) {
              var spilled = child.lines.splice(child.lines.length - 25, 25);
              var newleaf = new LeafChunk(spilled);
              child.height -= newleaf.height;
              this.children.splice(i + 1, 0, newleaf);
              newleaf.parent = this;
            }
            this.maybeSpill();
          }
          break;
        }
        at -= sz;
      }
    },
    // When a node has grown, check whether it should be split.
    maybeSpill: function() {
      if (this.children.length <= 10) return;
      var me = this;
      do {
        var spilled = me.children.splice(me.children.length - 5, 5);
        var sibling = new BranchChunk(spilled);
        if (!me.parent) { // Become the parent node
          var copy = new BranchChunk(me.children);
          copy.parent = me;
          me.children = [copy, sibling];
          me = copy;
        } else {
          me.size -= sibling.size;
          me.height -= sibling.height;
          var myIndex = indexOf(me.parent.children, me);
          me.parent.children.splice(myIndex + 1, 0, sibling);
        }
        sibling.parent = me.parent;
      } while (me.children.length > 10);
      me.parent.maybeSpill();
    },
    iterN: function(at, n, op) {
      for (var i = 0; i < this.children.length; ++i) {
        var child = this.children[i], sz = child.chunkSize();
        if (at < sz) {
          var used = Math.min(n, sz - at);
          if (child.iterN(at, used, op)) return true;
          if ((n -= used) == 0) break;
          at = 0;
        } else at -= sz;
      }
    }
  };

  var nextDocId = 0;
  var Doc = CodeMirror.Doc = function(text, mode, firstLine, lineSep) {
    if (!(this instanceof Doc)) return new Doc(text, mode, firstLine, lineSep);
    if (firstLine == null) firstLine = 0;

    BranchChunk.call(this, [new LeafChunk([new Line("", null)])]);
    this.first = firstLine;
    this.scrollTop = this.scrollLeft = 0;
    this.cantEdit = false;
    this.cleanGeneration = 1;
    this.frontier = firstLine;
    var start = Pos(firstLine, 0);
    this.sel = simpleSelection(start);
    this.history = new History(null);
    this.id = ++nextDocId;
    this.modeOption = mode;
    this.lineSep = lineSep;

    if (typeof text == "string") text = this.splitLines(text);
    updateDoc(this, {from: start, to: start, text: text});
    setSelection(this, simpleSelection(start), sel_dontScroll);
  };

  Doc.prototype = createObj(BranchChunk.prototype, {
    constructor: Doc,
    // Iterate over the document. Supports two forms -- with only one
    // argument, it calls that for each line in the document. With
    // three, it iterates over the range given by the first two (with
    // the second being non-inclusive).
    iter: function(from, to, op) {
      if (op) this.iterN(from - this.first, to - from, op);
      else this.iterN(this.first, this.first + this.size, from);
    },

    // Non-public interface for adding and removing lines.
    insert: function(at, lines) {
      var height = 0;
      for (var i = 0; i < lines.length; ++i) height += lines[i].height;
      this.insertInner(at - this.first, lines, height);
    },
    remove: function(at, n) { this.removeInner(at - this.first, n); },

    // From here, the methods are part of the public interface. Most
    // are also available from CodeMirror (editor) instances.

    getValue: function(lineSep) {
      var lines = getLines(this, this.first, this.first + this.size);
      if (lineSep === false) return lines;
      return lines.join(lineSep || this.lineSeparator());
    },
    setValue: docMethodOp(function(code) {
      var top = Pos(this.first, 0), last = this.first + this.size - 1;
      makeChange(this, {from: top, to: Pos(last, getLine(this, last).text.length),
                        text: this.splitLines(code), origin: "setValue", full: true}, true);
      setSelection(this, simpleSelection(top));
    }),
    replaceRange: function(code, from, to, origin) {
      from = clipPos(this, from);
      to = to ? clipPos(this, to) : from;
      replaceRange(this, code, from, to, origin);
    },
    getRange: function(from, to, lineSep) {
      var lines = getBetween(this, clipPos(this, from), clipPos(this, to));
      if (lineSep === false) return lines;
      return lines.join(lineSep || this.lineSeparator());
    },

    getLine: function(line) {var l = this.getLineHandle(line); return l && l.text;},

    getLineHandle: function(line) {if (isLine(this, line)) return getLine(this, line);},
    getLineNumber: function(line) {return lineNo(line);},

    getLineHandleVisualStart: function(line) {
      if (typeof line == "number") line = getLine(this, line);
      return visualLine(line);
    },

    lineCount: function() {return this.size;},
    firstLine: function() {return this.first;},
    lastLine: function() {return this.first + this.size - 1;},

    clipPos: function(pos) {return clipPos(this, pos);},

    getCursor: function(start) {
      var range = this.sel.primary(), pos;
      if (start == null || start == "head") pos = range.head;
      else if (start == "anchor") pos = range.anchor;
      else if (start == "end" || start == "to" || start === false) pos = range.to();
      else pos = range.from();
      return pos;
    },
    listSelections: function() { return this.sel.ranges; },
    somethingSelected: function() {return this.sel.somethingSelected();},

    setCursor: docMethodOp(function(line, ch, options) {
      setSimpleSelection(this, clipPos(this, typeof line == "number" ? Pos(line, ch || 0) : line), null, options);
    }),
    setSelection: docMethodOp(function(anchor, head, options) {
      setSimpleSelection(this, clipPos(this, anchor), clipPos(this, head || anchor), options);
    }),
    extendSelection: docMethodOp(function(head, other, options) {
      extendSelection(this, clipPos(this, head), other && clipPos(this, other), options);
    }),
    extendSelections: docMethodOp(function(heads, options) {
      extendSelections(this, clipPosArray(this, heads, options));
    }),
    extendSelectionsBy: docMethodOp(function(f, options) {
      extendSelections(this, map(this.sel.ranges, f), options);
    }),
    setSelections: docMethodOp(function(ranges, primary, options) {
      if (!ranges.length) return;
      for (var i = 0, out = []; i < ranges.length; i++)
        out[i] = new Range(clipPos(this, ranges[i].anchor),
                           clipPos(this, ranges[i].head));
      if (primary == null) primary = Math.min(ranges.length - 1, this.sel.primIndex);
      setSelection(this, normalizeSelection(out, primary), options);
    }),
    addSelection: docMethodOp(function(anchor, head, options) {
      var ranges = this.sel.ranges.slice(0);
      ranges.push(new Range(clipPos(this, anchor), clipPos(this, head || anchor)));
      setSelection(this, normalizeSelection(ranges, ranges.length - 1), options);
    }),

    getSelection: function(lineSep) {
      var ranges = this.sel.ranges, lines;
      for (var i = 0; i < ranges.length; i++) {
        var sel = getBetween(this, ranges[i].from(), ranges[i].to());
        lines = lines ? lines.concat(sel) : sel;
      }
      if (lineSep === false) return lines;
      else return lines.join(lineSep || this.lineSeparator());
    },
    getSelections: function(lineSep) {
      var parts = [], ranges = this.sel.ranges;
      for (var i = 0; i < ranges.length; i++) {
        var sel = getBetween(this, ranges[i].from(), ranges[i].to());
        if (lineSep !== false) sel = sel.join(lineSep || this.lineSeparator());
        parts[i] = sel;
      }
      return parts;
    },
    replaceSelection: function(code, collapse, origin) {
      var dup = [];
      for (var i = 0; i < this.sel.ranges.length; i++)
        dup[i] = code;
      this.replaceSelections(dup, collapse, origin || "+input");
    },
    replaceSelections: docMethodOp(function(code, collapse, origin) {
      var changes = [], sel = this.sel;
      for (var i = 0; i < sel.ranges.length; i++) {
        var range = sel.ranges[i];
        changes[i] = {from: range.from(), to: range.to(), text: this.splitLines(code[i]), origin: origin};
      }
      var newSel = collapse && collapse != "end" && computeReplacedSel(this, changes, collapse);
      for (var i = changes.length - 1; i >= 0; i--)
        makeChange(this, changes[i]);
      if (newSel) setSelectionReplaceHistory(this, newSel);
      else if (this.cm) ensureCursorVisible(this.cm);
    }),
    undo: docMethodOp(function() {makeChangeFromHistory(this, "undo");}),
    redo: docMethodOp(function() {makeChangeFromHistory(this, "redo");}),
    undoSelection: docMethodOp(function() {makeChangeFromHistory(this, "undo", true);}),
    redoSelection: docMethodOp(function() {makeChangeFromHistory(this, "redo", true);}),

    setExtending: function(val) {this.extend = val;},
    getExtending: function() {return this.extend;},

    historySize: function() {
      var hist = this.history, done = 0, undone = 0;
      for (var i = 0; i < hist.done.length; i++) if (!hist.done[i].ranges) ++done;
      for (var i = 0; i < hist.undone.length; i++) if (!hist.undone[i].ranges) ++undone;
      return {undo: done, redo: undone};
    },
    clearHistory: function() {this.history = new History(this.history.maxGeneration);},

    markClean: function() {
      this.cleanGeneration = this.changeGeneration(true);
    },
    changeGeneration: function(forceSplit) {
      if (forceSplit)
        this.history.lastOp = this.history.lastSelOp = this.history.lastOrigin = null;
      return this.history.generation;
    },
    isClean: function (gen) {
      return this.history.generation == (gen || this.cleanGeneration);
    },

    getHistory: function() {
      return {done: copyHistoryArray(this.history.done),
              undone: copyHistoryArray(this.history.undone)};
    },
    setHistory: function(histData) {
      var hist = this.history = new History(this.history.maxGeneration);
      hist.done = copyHistoryArray(histData.done.slice(0), null, true);
      hist.undone = copyHistoryArray(histData.undone.slice(0), null, true);
    },

    addLineClass: docMethodOp(function(handle, where, cls) {
      return changeLine(this, handle, where == "gutter" ? "gutter" : "class", function(line) {
        var prop = where == "text" ? "textClass"
                 : where == "background" ? "bgClass"
                 : where == "gutter" ? "gutterClass" : "wrapClass";
        if (!line[prop]) line[prop] = cls;
        else if (classTest(cls).test(line[prop])) return false;
        else line[prop] += " " + cls;
        return true;
      });
    }),
    removeLineClass: docMethodOp(function(handle, where, cls) {
      return changeLine(this, handle, where == "gutter" ? "gutter" : "class", function(line) {
        var prop = where == "text" ? "textClass"
                 : where == "background" ? "bgClass"
                 : where == "gutter" ? "gutterClass" : "wrapClass";
        var cur = line[prop];
        if (!cur) return false;
        else if (cls == null) line[prop] = null;
        else {
          var found = cur.match(classTest(cls));
          if (!found) return false;
          var end = found.index + found[0].length;
          line[prop] = cur.slice(0, found.index) + (!found.index || end == cur.length ? "" : " ") + cur.slice(end) || null;
        }
        return true;
      });
    }),

    addLineWidget: docMethodOp(function(handle, node, options) {
      return addLineWidget(this, handle, node, options);
    }),
    removeLineWidget: function(widget) { widget.clear(); },

    markText: function(from, to, options) {
      return markText(this, clipPos(this, from), clipPos(this, to), options, options && options.type || "range");
    },
    setBookmark: function(pos, options) {
      var realOpts = {replacedWith: options && (options.nodeType == null ? options.widget : options),
                      insertLeft: options && options.insertLeft,
                      clearWhenEmpty: false, shared: options && options.shared,
                      handleMouseEvents: options && options.handleMouseEvents};
      pos = clipPos(this, pos);
      return markText(this, pos, pos, realOpts, "bookmark");
    },
    findMarksAt: function(pos) {
      pos = clipPos(this, pos);
      var markers = [], spans = getLine(this, pos.line).markedSpans;
      if (spans) for (var i = 0; i < spans.length; ++i) {
        var span = spans[i];
        if ((span.from == null || span.from <= pos.ch) &&
            (span.to == null || span.to >= pos.ch))
          markers.push(span.marker.parent || span.marker);
      }
      return markers;
    },
    findMarks: function(from, to, filter) {
      from = clipPos(this, from); to = clipPos(this, to);
      var found = [], lineNo = from.line;
      this.iter(from.line, to.line + 1, function(line) {
        var spans = line.markedSpans;
        if (spans) for (var i = 0; i < spans.length; i++) {
          var span = spans[i];
          if (!(lineNo == from.line && from.ch > span.to ||
                span.from == null && lineNo != from.line||
                lineNo == to.line && span.from > to.ch) &&
              (!filter || filter(span.marker)))
            found.push(span.marker.parent || span.marker);
        }
        ++lineNo;
      });
      return found;
    },
    getAllMarks: function() {
      var markers = [];
      this.iter(function(line) {
        var sps = line.markedSpans;
        if (sps) for (var i = 0; i < sps.length; ++i)
          if (sps[i].from != null) markers.push(sps[i].marker);
      });
      return markers;
    },

    posFromIndex: function(off) {
      var ch, lineNo = this.first;
      this.iter(function(line) {
        var sz = line.text.length + 1;
        if (sz > off) { ch = off; return true; }
        off -= sz;
        ++lineNo;
      });
      return clipPos(this, Pos(lineNo, ch));
    },
    indexFromPos: function (coords) {
      coords = clipPos(this, coords);
      var index = coords.ch;
      if (coords.line < this.first || coords.ch < 0) return 0;
      this.iter(this.first, coords.line, function (line) {
        index += line.text.length + 1;
      });
      return index;
    },

    copy: function(copyHistory) {
      var doc = new Doc(getLines(this, this.first, this.first + this.size),
                        this.modeOption, this.first, this.lineSep);
      doc.scrollTop = this.scrollTop; doc.scrollLeft = this.scrollLeft;
      doc.sel = this.sel;
      doc.extend = false;
      if (copyHistory) {
        doc.history.undoDepth = this.history.undoDepth;
        doc.setHistory(this.getHistory());
      }
      return doc;
    },

    linkedDoc: function(options) {
      if (!options) options = {};
      var from = this.first, to = this.first + this.size;
      if (options.from != null && options.from > from) from = options.from;
      if (options.to != null && options.to < to) to = options.to;
      var copy = new Doc(getLines(this, from, to), options.mode || this.modeOption, from, this.lineSep);
      if (options.sharedHist) copy.history = this.history;
      (this.linked || (this.linked = [])).push({doc: copy, sharedHist: options.sharedHist});
      copy.linked = [{doc: this, isParent: true, sharedHist: options.sharedHist}];
      copySharedMarkers(copy, findSharedMarkers(this));
      return copy;
    },
    unlinkDoc: function(other) {
      if (other instanceof CodeMirror) other = other.doc;
      if (this.linked) for (var i = 0; i < this.linked.length; ++i) {
        var link = this.linked[i];
        if (link.doc != other) continue;
        this.linked.splice(i, 1);
        other.unlinkDoc(this);
        detachSharedMarkers(findSharedMarkers(this));
        break;
      }
      // If the histories were shared, split them again
      if (other.history == this.history) {
        var splitIds = [other.id];
        linkedDocs(other, function(doc) {splitIds.push(doc.id);}, true);
        other.history = new History(null);
        other.history.done = copyHistoryArray(this.history.done, splitIds);
        other.history.undone = copyHistoryArray(this.history.undone, splitIds);
      }
    },
    iterLinkedDocs: function(f) {linkedDocs(this, f);},

    getMode: function() {return this.mode;},
    getEditor: function() {return this.cm;},

    splitLines: function(str) {
      if (this.lineSep) return str.split(this.lineSep);
      return splitLinesAuto(str);
    },
    lineSeparator: function() { return this.lineSep || "\n"; }
  });

  // Public alias.
  Doc.prototype.eachLine = Doc.prototype.iter;

  // Set up methods on CodeMirror's prototype to redirect to the editor's document.
  var dontDelegate = "iter insert remove copy getEditor constructor".split(" ");
  for (var prop in Doc.prototype) if (Doc.prototype.hasOwnProperty(prop) && indexOf(dontDelegate, prop) < 0)
    CodeMirror.prototype[prop] = (function(method) {
      return function() {return method.apply(this.doc, arguments);};
    })(Doc.prototype[prop]);

  eventMixin(Doc);

  // Call f for all linked documents.
  function linkedDocs(doc, f, sharedHistOnly) {
    function propagate(doc, skip, sharedHist) {
      if (doc.linked) for (var i = 0; i < doc.linked.length; ++i) {
        var rel = doc.linked[i];
        if (rel.doc == skip) continue;
        var shared = sharedHist && rel.sharedHist;
        if (sharedHistOnly && !shared) continue;
        f(rel.doc, shared);
        propagate(rel.doc, doc, shared);
      }
    }
    propagate(doc, null, true);
  }

  // Attach a document to an editor.
  function attachDoc(cm, doc) {
    if (doc.cm) throw new Error("This document is already in use.");
    cm.doc = doc;
    doc.cm = cm;
    estimateLineHeights(cm);
    loadMode(cm);
    if (!cm.options.lineWrapping) findMaxLine(cm);
    cm.options.mode = doc.modeOption;
    regChange(cm);
  }

  // LINE UTILITIES

  // Find the line object corresponding to the given line number.
  function getLine(doc, n) {
    n -= doc.first;
    if (n < 0 || n >= doc.size) throw new Error("There is no line " + (n + doc.first) + " in the document.");
    for (var chunk = doc; !chunk.lines;) {
      for (var i = 0;; ++i) {
        var child = chunk.children[i], sz = child.chunkSize();
        if (n < sz) { chunk = child; break; }
        n -= sz;
      }
    }
    return chunk.lines[n];
  }

  // Get the part of a document between two positions, as an array of
  // strings.
  function getBetween(doc, start, end) {
    var out = [], n = start.line;
    doc.iter(start.line, end.line + 1, function(line) {
      var text = line.text;
      if (n == end.line) text = text.slice(0, end.ch);
      if (n == start.line) text = text.slice(start.ch);
      out.push(text);
      ++n;
    });
    return out;
  }
  // Get the lines between from and to, as array of strings.
  function getLines(doc, from, to) {
    var out = [];
    doc.iter(from, to, function(line) { out.push(line.text); });
    return out;
  }

  // Update the height of a line, propagating the height change
  // upwards to parent nodes.
  function updateLineHeight(line, height) {
    var diff = height - line.height;
    if (diff) for (var n = line; n; n = n.parent) n.height += diff;
  }

  // Given a line object, find its line number by walking up through
  // its parent links.
  function lineNo(line) {
    if (line.parent == null) return null;
    var cur = line.parent, no = indexOf(cur.lines, line);
    for (var chunk = cur.parent; chunk; cur = chunk, chunk = chunk.parent) {
      for (var i = 0;; ++i) {
        if (chunk.children[i] == cur) break;
        no += chunk.children[i].chunkSize();
      }
    }
    return no + cur.first;
  }

  // Find the line at the given vertical position, using the height
  // information in the document tree.
  function lineAtHeight(chunk, h) {
    var n = chunk.first;
    outer: do {
      for (var i = 0; i < chunk.children.length; ++i) {
        var child = chunk.children[i], ch = child.height;
        if (h < ch) { chunk = child; continue outer; }
        h -= ch;
        n += child.chunkSize();
      }
      return n;
    } while (!chunk.lines);
    for (var i = 0; i < chunk.lines.length; ++i) {
      var line = chunk.lines[i], lh = line.height;
      if (h < lh) break;
      h -= lh;
    }
    return n + i;
  }


  // Find the height above the given line.
  function heightAtLine(lineObj) {
    lineObj = visualLine(lineObj);

    var h = 0, chunk = lineObj.parent;
    for (var i = 0; i < chunk.lines.length; ++i) {
      var line = chunk.lines[i];
      if (line == lineObj) break;
      else h += line.height;
    }
    for (var p = chunk.parent; p; chunk = p, p = chunk.parent) {
      for (var i = 0; i < p.children.length; ++i) {
        var cur = p.children[i];
        if (cur == chunk) break;
        else h += cur.height;
      }
    }
    return h;
  }

  // Get the bidi ordering for the given line (and cache it). Returns
  // false for lines that are fully left-to-right, and an array of
  // BidiSpan objects otherwise.
  function getOrder(line) {
    var order = line.order;
    if (order == null) order = line.order = bidiOrdering(line.text);
    return order;
  }

  // HISTORY

  function History(startGen) {
    // Arrays of change events and selections. Doing something adds an
    // event to done and clears undo. Undoing moves events from done
    // to undone, redoing moves them in the other direction.
    this.done = []; this.undone = [];
    this.undoDepth = Infinity;
    // Used to track when changes can be merged into a single undo
    // event
    this.lastModTime = this.lastSelTime = 0;
    this.lastOp = this.lastSelOp = null;
    this.lastOrigin = this.lastSelOrigin = null;
    // Used by the isClean() method
    this.generation = this.maxGeneration = startGen || 1;
  }

  // Create a history change event from an updateDoc-style change
  // object.
  function historyChangeFromChange(doc, change) {
    var histChange = {from: copyPos(change.from), to: changeEnd(change), text: getBetween(doc, change.from, change.to)};
    attachLocalSpans(doc, histChange, change.from.line, change.to.line + 1);
    linkedDocs(doc, function(doc) {attachLocalSpans(doc, histChange, change.from.line, change.to.line + 1);}, true);
    return histChange;
  }

  // Pop all selection events off the end of a history array. Stop at
  // a change event.
  function clearSelectionEvents(array) {
    while (array.length) {
      var last = lst(array);
      if (last.ranges) array.pop();
      else break;
    }
  }

  // Find the top change event in the history. Pop off selection
  // events that are in the way.
  function lastChangeEvent(hist, force) {
    if (force) {
      clearSelectionEvents(hist.done);
      return lst(hist.done);
    } else if (hist.done.length && !lst(hist.done).ranges) {
      return lst(hist.done);
    } else if (hist.done.length > 1 && !hist.done[hist.done.length - 2].ranges) {
      hist.done.pop();
      return lst(hist.done);
    }
  }

  // Register a change in the history. Merges changes that are within
  // a single operation, ore are close together with an origin that
  // allows merging (starting with "+") into a single event.
  function addChangeToHistory(doc, change, selAfter, opId) {
    var hist = doc.history;
    hist.undone.length = 0;
    var time = +new Date, cur;

    if ((hist.lastOp == opId ||
         hist.lastOrigin == change.origin && change.origin &&
         ((change.origin.charAt(0) == "+" && doc.cm && hist.lastModTime > time - doc.cm.options.historyEventDelay) ||
          change.origin.charAt(0) == "*")) &&
        (cur = lastChangeEvent(hist, hist.lastOp == opId))) {
      // Merge this change into the last event
      var last = lst(cur.changes);
      if (cmp(change.from, change.to) == 0 && cmp(change.from, last.to) == 0) {
        // Optimized case for simple insertion -- don't want to add
        // new changesets for every character typed
        last.to = changeEnd(change);
      } else {
        // Add new sub-event
        cur.changes.push(historyChangeFromChange(doc, change));
      }
    } else {
      // Can not be merged, start a new event.
      var before = lst(hist.done);
      if (!before || !before.ranges)
        pushSelectionToHistory(doc.sel, hist.done);
      cur = {changes: [historyChangeFromChange(doc, change)],
             generation: hist.generation};
      hist.done.push(cur);
      while (hist.done.length > hist.undoDepth) {
        hist.done.shift();
        if (!hist.done[0].ranges) hist.done.shift();
      }
    }
    hist.done.push(selAfter);
    hist.generation = ++hist.maxGeneration;
    hist.lastModTime = hist.lastSelTime = time;
    hist.lastOp = hist.lastSelOp = opId;
    hist.lastOrigin = hist.lastSelOrigin = change.origin;

    if (!last) signal(doc, "historyAdded");
  }

  function selectionEventCanBeMerged(doc, origin, prev, sel) {
    var ch = origin.charAt(0);
    return ch == "*" ||
      ch == "+" &&
      prev.ranges.length == sel.ranges.length &&
      prev.somethingSelected() == sel.somethingSelected() &&
      new Date - doc.history.lastSelTime <= (doc.cm ? doc.cm.options.historyEventDelay : 500);
  }

  // Called whenever the selection changes, sets the new selection as
  // the pending selection in the history, and pushes the old pending
  // selection into the 'done' array when it was significantly
  // different (in number of selected ranges, emptiness, or time).
  function addSelectionToHistory(doc, sel, opId, options) {
    var hist = doc.history, origin = options && options.origin;

    // A new event is started when the previous origin does not match
    // the current, or the origins don't allow matching. Origins
    // starting with * are always merged, those starting with + are
    // merged when similar and close together in time.
    if (opId == hist.lastSelOp ||
        (origin && hist.lastSelOrigin == origin &&
         (hist.lastModTime == hist.lastSelTime && hist.lastOrigin == origin ||
          selectionEventCanBeMerged(doc, origin, lst(hist.done), sel))))
      hist.done[hist.done.length - 1] = sel;
    else
      pushSelectionToHistory(sel, hist.done);

    hist.lastSelTime = +new Date;
    hist.lastSelOrigin = origin;
    hist.lastSelOp = opId;
    if (options && options.clearRedo !== false)
      clearSelectionEvents(hist.undone);
  }

  function pushSelectionToHistory(sel, dest) {
    var top = lst(dest);
    if (!(top && top.ranges && top.equals(sel)))
      dest.push(sel);
  }

  // Used to store marked span information in the history.
  function attachLocalSpans(doc, change, from, to) {
    var existing = change["spans_" + doc.id], n = 0;
    doc.iter(Math.max(doc.first, from), Math.min(doc.first + doc.size, to), function(line) {
      if (line.markedSpans)
        (existing || (existing = change["spans_" + doc.id] = {}))[n] = line.markedSpans;
      ++n;
    });
  }

  // When un/re-doing restores text containing marked spans, those
  // that have been explicitly cleared should not be restored.
  function removeClearedSpans(spans) {
    if (!spans) return null;
    for (var i = 0, out; i < spans.length; ++i) {
      if (spans[i].marker.explicitlyCleared) { if (!out) out = spans.slice(0, i); }
      else if (out) out.push(spans[i]);
    }
    return !out ? spans : out.length ? out : null;
  }

  // Retrieve and filter the old marked spans stored in a change event.
  function getOldSpans(doc, change) {
    var found = change["spans_" + doc.id];
    if (!found) return null;
    for (var i = 0, nw = []; i < change.text.length; ++i)
      nw.push(removeClearedSpans(found[i]));
    return nw;
  }

  // Used both to provide a JSON-safe object in .getHistory, and, when
  // detaching a document, to split the history in two
  function copyHistoryArray(events, newGroup, instantiateSel) {
    for (var i = 0, copy = []; i < events.length; ++i) {
      var event = events[i];
      if (event.ranges) {
        copy.push(instantiateSel ? Selection.prototype.deepCopy.call(event) : event);
        continue;
      }
      var changes = event.changes, newChanges = [];
      copy.push({changes: newChanges});
      for (var j = 0; j < changes.length; ++j) {
        var change = changes[j], m;
        newChanges.push({from: change.from, to: change.to, text: change.text});
        if (newGroup) for (var prop in change) if (m = prop.match(/^spans_(\d+)$/)) {
          if (indexOf(newGroup, Number(m[1])) > -1) {
            lst(newChanges)[prop] = change[prop];
            delete change[prop];
          }
        }
      }
    }
    return copy;
  }

  // Rebasing/resetting history to deal with externally-sourced changes

  function rebaseHistSelSingle(pos, from, to, diff) {
    if (to < pos.line) {
      pos.line += diff;
    } else if (from < pos.line) {
      pos.line = from;
      pos.ch = 0;
    }
  }

  // Tries to rebase an array of history events given a change in the
  // document. If the change touches the same lines as the event, the
  // event, and everything 'behind' it, is discarded. If the change is
  // before the event, the event's positions are updated. Uses a
  // copy-on-write scheme for the positions, to avoid having to
  // reallocate them all on every rebase, but also avoid problems with
  // shared position objects being unsafely updated.
  function rebaseHistArray(array, from, to, diff) {
    for (var i = 0; i < array.length; ++i) {
      var sub = array[i], ok = true;
      if (sub.ranges) {
        if (!sub.copied) { sub = array[i] = sub.deepCopy(); sub.copied = true; }
        for (var j = 0; j < sub.ranges.length; j++) {
          rebaseHistSelSingle(sub.ranges[j].anchor, from, to, diff);
          rebaseHistSelSingle(sub.ranges[j].head, from, to, diff);
        }
        continue;
      }
      for (var j = 0; j < sub.changes.length; ++j) {
        var cur = sub.changes[j];
        if (to < cur.from.line) {
          cur.from = Pos(cur.from.line + diff, cur.from.ch);
          cur.to = Pos(cur.to.line + diff, cur.to.ch);
        } else if (from <= cur.to.line) {
          ok = false;
          break;
        }
      }
      if (!ok) {
        array.splice(0, i + 1);
        i = 0;
      }
    }
  }

  function rebaseHist(hist, change) {
    var from = change.from.line, to = change.to.line, diff = change.text.length - (to - from) - 1;
    rebaseHistArray(hist.done, from, to, diff);
    rebaseHistArray(hist.undone, from, to, diff);
  }

  // EVENT UTILITIES

  // Due to the fact that we still support jurassic IE versions, some
  // compatibility wrappers are needed.

  var e_preventDefault = CodeMirror.e_preventDefault = function(e) {
    if (e.preventDefault) e.preventDefault();
    else e.returnValue = false;
  };
  var e_stopPropagation = CodeMirror.e_stopPropagation = function(e) {
    if (e.stopPropagation) e.stopPropagation();
    else e.cancelBubble = true;
  };
  function e_defaultPrevented(e) {
    return e.defaultPrevented != null ? e.defaultPrevented : e.returnValue == false;
  }
  var e_stop = CodeMirror.e_stop = function(e) {e_preventDefault(e); e_stopPropagation(e);};

  function e_target(e) {return e.target || e.srcElement;}
  function e_button(e) {
    var b = e.which;
    if (b == null) {
      if (e.button & 1) b = 1;
      else if (e.button & 2) b = 3;
      else if (e.button & 4) b = 2;
    }
    if (mac && e.ctrlKey && b == 1) b = 3;
    return b;
  }

  // EVENT HANDLING

  // Lightweight event framework. on/off also work on DOM nodes,
  // registering native DOM handlers.

  var on = CodeMirror.on = function(emitter, type, f) {
    if (emitter.addEventListener)
      emitter.addEventListener(type, f, false);
    else if (emitter.attachEvent)
      emitter.attachEvent("on" + type, f);
    else {
      var map = emitter._handlers || (emitter._handlers = {});
      var arr = map[type] || (map[type] = []);
      arr.push(f);
    }
  };

  var noHandlers = []
  function getHandlers(emitter, type, copy) {
    var arr = emitter._handlers && emitter._handlers[type]
    if (copy) return arr && arr.length > 0 ? arr.slice() : noHandlers
    else return arr || noHandlers
  }

  var off = CodeMirror.off = function(emitter, type, f) {
    if (emitter.removeEventListener)
      emitter.removeEventListener(type, f, false);
    else if (emitter.detachEvent)
      emitter.detachEvent("on" + type, f);
    else {
      var handlers = getHandlers(emitter, type, false)
      for (var i = 0; i < handlers.length; ++i)
        if (handlers[i] == f) { handlers.splice(i, 1); break; }
    }
  };

  var signal = CodeMirror.signal = function(emitter, type /*, values...*/) {
    var handlers = getHandlers(emitter, type, true)
    if (!handlers.length) return;
    var args = Array.prototype.slice.call(arguments, 2);
    for (var i = 0; i < handlers.length; ++i) handlers[i].apply(null, args);
  };

  var orphanDelayedCallbacks = null;

  // Often, we want to signal events at a point where we are in the
  // middle of some work, but don't want the handler to start calling
  // other methods on the editor, which might be in an inconsistent
  // state or simply not expect any other events to happen.
  // signalLater looks whether there are any handlers, and schedules
  // them to be executed when the last operation ends, or, if no
  // operation is active, when a timeout fires.
  function signalLater(emitter, type /*, values...*/) {
    var arr = getHandlers(emitter, type, false)
    if (!arr.length) return;
    var args = Array.prototype.slice.call(arguments, 2), list;
    if (operationGroup) {
      list = operationGroup.delayedCallbacks;
    } else if (orphanDelayedCallbacks) {
      list = orphanDelayedCallbacks;
    } else {
      list = orphanDelayedCallbacks = [];
      setTimeout(fireOrphanDelayed, 0);
    }
    function bnd(f) {return function(){f.apply(null, args);};};
    for (var i = 0; i < arr.length; ++i)
      list.push(bnd(arr[i]));
  }

  function fireOrphanDelayed() {
    var delayed = orphanDelayedCallbacks;
    orphanDelayedCallbacks = null;
    for (var i = 0; i < delayed.length; ++i) delayed[i]();
  }

  // The DOM events that CodeMirror handles can be overridden by
  // registering a (non-DOM) handler on the editor for the event name,
  // and preventDefault-ing the event in that handler.
  function signalDOMEvent(cm, e, override) {
    if (typeof e == "string")
      e = {type: e, preventDefault: function() { this.defaultPrevented = true; }};
    signal(cm, override || e.type, cm, e);
    return e_defaultPrevented(e) || e.codemirrorIgnore;
  }

  function signalCursorActivity(cm) {
    var arr = cm._handlers && cm._handlers.cursorActivity;
    if (!arr) return;
    var set = cm.curOp.cursorActivityHandlers || (cm.curOp.cursorActivityHandlers = []);
    for (var i = 0; i < arr.length; ++i) if (indexOf(set, arr[i]) == -1)
      set.push(arr[i]);
  }

  function hasHandler(emitter, type) {
    return getHandlers(emitter, type).length > 0
  }

  // Add on and off methods to a constructor's prototype, to make
  // registering events on such objects more convenient.
  function eventMixin(ctor) {
    ctor.prototype.on = function(type, f) {on(this, type, f);};
    ctor.prototype.off = function(type, f) {off(this, type, f);};
  }

  // MISC UTILITIES

  // Number of pixels added to scroller and sizer to hide scrollbar
  var scrollerGap = 30;

  // Returned or thrown by various protocols to signal 'I'm not
  // handling this'.
  var Pass = CodeMirror.Pass = {toString: function(){return "CodeMirror.Pass";}};

  // Reused option objects for setSelection & friends
  var sel_dontScroll = {scroll: false}, sel_mouse = {origin: "*mouse"}, sel_move = {origin: "+move"};

  function Delayed() {this.id = null;}
  Delayed.prototype.set = function(ms, f) {
    clearTimeout(this.id);
    this.id = setTimeout(f, ms);
  };

  // Counts the column offset in a string, taking tabs into account.
  // Used mostly to find indentation.
  var countColumn = CodeMirror.countColumn = function(string, end, tabSize, startIndex, startValue) {
    if (end == null) {
      end = string.search(/[^\s\u00a0]/);
      if (end == -1) end = string.length;
    }
    for (var i = startIndex || 0, n = startValue || 0;;) {
      var nextTab = string.indexOf("\t", i);
      if (nextTab < 0 || nextTab >= end)
        return n + (end - i);
      n += nextTab - i;
      n += tabSize - (n % tabSize);
      i = nextTab + 1;
    }
  };

  // The inverse of countColumn -- find the offset that corresponds to
  // a particular column.
  var findColumn = CodeMirror.findColumn = function(string, goal, tabSize) {
    for (var pos = 0, col = 0;;) {
      var nextTab = string.indexOf("\t", pos);
      if (nextTab == -1) nextTab = string.length;
      var skipped = nextTab - pos;
      if (nextTab == string.length || col + skipped >= goal)
        return pos + Math.min(skipped, goal - col);
      col += nextTab - pos;
      col += tabSize - (col % tabSize);
      pos = nextTab + 1;
      if (col >= goal) return pos;
    }
  }

  var spaceStrs = [""];
  function spaceStr(n) {
    while (spaceStrs.length <= n)
      spaceStrs.push(lst(spaceStrs) + " ");
    return spaceStrs[n];
  }

  function lst(arr) { return arr[arr.length-1]; }

  var selectInput = function(node) { node.select(); };
  if (ios) // Mobile Safari apparently has a bug where select() is broken.
    selectInput = function(node) { node.selectionStart = 0; node.selectionEnd = node.value.length; };
  else if (ie) // Suppress mysterious IE10 errors
    selectInput = function(node) { try { node.select(); } catch(_e) {} };

  function indexOf(array, elt) {
    for (var i = 0; i < array.length; ++i)
      if (array[i] == elt) return i;
    return -1;
  }
  function map(array, f) {
    var out = [];
    for (var i = 0; i < array.length; i++) out[i] = f(array[i], i);
    return out;
  }

  function nothing() {}

  function createObj(base, props) {
    var inst;
    if (Object.create) {
      inst = Object.create(base);
    } else {
      nothing.prototype = base;
      inst = new nothing();
    }
    if (props) copyObj(props, inst);
    return inst;
  };

  function copyObj(obj, target, overwrite) {
    if (!target) target = {};
    for (var prop in obj)
      if (obj.hasOwnProperty(prop) && (overwrite !== false || !target.hasOwnProperty(prop)))
        target[prop] = obj[prop];
    return target;
  }

  function bind(f) {
    var args = Array.prototype.slice.call(arguments, 1);
    return function(){return f.apply(null, args);};
  }

  var nonASCIISingleCaseWordChar = /[\u00df\u0587\u0590-\u05f4\u0600-\u06ff\u3040-\u309f\u30a0-\u30ff\u3400-\u4db5\u4e00-\u9fcc\uac00-\ud7af]/;
  var isWordCharBasic = CodeMirror.isWordChar = function(ch) {
    return /\w/.test(ch) || ch > "\x80" &&
      (ch.toUpperCase() != ch.toLowerCase() || nonASCIISingleCaseWordChar.test(ch));
  };
  function isWordChar(ch, helper) {
    if (!helper) return isWordCharBasic(ch);
    if (helper.source.indexOf("\\w") > -1 && isWordCharBasic(ch)) return true;
    return helper.test(ch);
  }

  function isEmpty(obj) {
    for (var n in obj) if (obj.hasOwnProperty(n) && obj[n]) return false;
    return true;
  }

  // Extending unicode characters. A series of a non-extending char +
  // any number of extending chars is treated as a single unit as far
  // as editing and measuring is concerned. This is not fully correct,
  // since some scripts/fonts/browsers also treat other configurations
  // of code points as a group.
  var extendingChars = /[\u0300-\u036f\u0483-\u0489\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u0610-\u061a\u064b-\u065e\u0670\u06d6-\u06dc\u06de-\u06e4\u06e7\u06e8\u06ea-\u06ed\u0711\u0730-\u074a\u07a6-\u07b0\u07eb-\u07f3\u0816-\u0819\u081b-\u0823\u0825-\u0827\u0829-\u082d\u0900-\u0902\u093c\u0941-\u0948\u094d\u0951-\u0955\u0962\u0963\u0981\u09bc\u09be\u09c1-\u09c4\u09cd\u09d7\u09e2\u09e3\u0a01\u0a02\u0a3c\u0a41\u0a42\u0a47\u0a48\u0a4b-\u0a4d\u0a51\u0a70\u0a71\u0a75\u0a81\u0a82\u0abc\u0ac1-\u0ac5\u0ac7\u0ac8\u0acd\u0ae2\u0ae3\u0b01\u0b3c\u0b3e\u0b3f\u0b41-\u0b44\u0b4d\u0b56\u0b57\u0b62\u0b63\u0b82\u0bbe\u0bc0\u0bcd\u0bd7\u0c3e-\u0c40\u0c46-\u0c48\u0c4a-\u0c4d\u0c55\u0c56\u0c62\u0c63\u0cbc\u0cbf\u0cc2\u0cc6\u0ccc\u0ccd\u0cd5\u0cd6\u0ce2\u0ce3\u0d3e\u0d41-\u0d44\u0d4d\u0d57\u0d62\u0d63\u0dca\u0dcf\u0dd2-\u0dd4\u0dd6\u0ddf\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\u0eb1\u0eb4-\u0eb9\u0ebb\u0ebc\u0ec8-\u0ecd\u0f18\u0f19\u0f35\u0f37\u0f39\u0f71-\u0f7e\u0f80-\u0f84\u0f86\u0f87\u0f90-\u0f97\u0f99-\u0fbc\u0fc6\u102d-\u1030\u1032-\u1037\u1039\u103a\u103d\u103e\u1058\u1059\u105e-\u1060\u1071-\u1074\u1082\u1085\u1086\u108d\u109d\u135f\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17b7-\u17bd\u17c6\u17c9-\u17d3\u17dd\u180b-\u180d\u18a9\u1920-\u1922\u1927\u1928\u1932\u1939-\u193b\u1a17\u1a18\u1a56\u1a58-\u1a5e\u1a60\u1a62\u1a65-\u1a6c\u1a73-\u1a7c\u1a7f\u1b00-\u1b03\u1b34\u1b36-\u1b3a\u1b3c\u1b42\u1b6b-\u1b73\u1b80\u1b81\u1ba2-\u1ba5\u1ba8\u1ba9\u1c2c-\u1c33\u1c36\u1c37\u1cd0-\u1cd2\u1cd4-\u1ce0\u1ce2-\u1ce8\u1ced\u1dc0-\u1de6\u1dfd-\u1dff\u200c\u200d\u20d0-\u20f0\u2cef-\u2cf1\u2de0-\u2dff\u302a-\u302f\u3099\u309a\ua66f-\ua672\ua67c\ua67d\ua6f0\ua6f1\ua802\ua806\ua80b\ua825\ua826\ua8c4\ua8e0-\ua8f1\ua926-\ua92d\ua947-\ua951\ua980-\ua982\ua9b3\ua9b6-\ua9b9\ua9bc\uaa29-\uaa2e\uaa31\uaa32\uaa35\uaa36\uaa43\uaa4c\uaab0\uaab2-\uaab4\uaab7\uaab8\uaabe\uaabf\uaac1\uabe5\uabe8\uabed\udc00-\udfff\ufb1e\ufe00-\ufe0f\ufe20-\ufe26\uff9e\uff9f]/;
  function isExtendingChar(ch) { return ch.charCodeAt(0) >= 768 && extendingChars.test(ch); }

  // DOM UTILITIES

  function elt(tag, content, className, style) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (style) e.style.cssText = style;
    if (typeof content == "string") e.appendChild(document.createTextNode(content));
    else if (content) for (var i = 0; i < content.length; ++i) e.appendChild(content[i]);
    return e;
  }

  var range;
  if (document.createRange) range = function(node, start, end, endNode) {
    var r = document.createRange();
    r.setEnd(endNode || node, end);
    r.setStart(node, start);
    return r;
  };
  else range = function(node, start, end) {
    var r = document.body.createTextRange();
    try { r.moveToElementText(node.parentNode); }
    catch(e) { return r; }
    r.collapse(true);
    r.moveEnd("character", end);
    r.moveStart("character", start);
    return r;
  };

  function removeChildren(e) {
    for (var count = e.childNodes.length; count > 0; --count)
      e.removeChild(e.firstChild);
    return e;
  }

  function removeChildrenAndAdd(parent, e) {
    return removeChildren(parent).appendChild(e);
  }

  var contains = CodeMirror.contains = function(parent, child) {
    if (child.nodeType == 3) // Android browser always returns false when child is a textnode
      child = child.parentNode;
    if (parent.contains)
      return parent.contains(child);
    do {
      if (child.nodeType == 11) child = child.host;
      if (child == parent) return true;
    } while (child = child.parentNode);
  };

  function activeElt() {
    var activeElement = document.activeElement;
    while (activeElement && activeElement.root && activeElement.root.activeElement)
      activeElement = activeElement.root.activeElement;
    return activeElement;
  }
  // Older versions of IE throws unspecified error when touching
  // document.activeElement in some cases (during loading, in iframe)
  if (ie && ie_version < 11) activeElt = function() {
    try { return document.activeElement; }
    catch(e) { return document.body; }
  };

  function classTest(cls) { return new RegExp("(^|\\s)" + cls + "(?:$|\\s)\\s*"); }
  var rmClass = CodeMirror.rmClass = function(node, cls) {
    var current = node.className;
    var match = classTest(cls).exec(current);
    if (match) {
      var after = current.slice(match.index + match[0].length);
      node.className = current.slice(0, match.index) + (after ? match[1] + after : "");
    }
  };
  var addClass = CodeMirror.addClass = function(node, cls) {
    var current = node.className;
    if (!classTest(cls).test(current)) node.className += (current ? " " : "") + cls;
  };
  function joinClasses(a, b) {
    var as = a.split(" ");
    for (var i = 0; i < as.length; i++)
      if (as[i] && !classTest(as[i]).test(b)) b += " " + as[i];
    return b;
  }

  // WINDOW-WIDE EVENTS

  // These must be handled carefully, because naively registering a
  // handler for each editor will cause the editors to never be
  // garbage collected.

  function forEachCodeMirror(f) {
    if (!document.body.getElementsByClassName) return;
    var byClass = document.body.getElementsByClassName("CodeMirror");
    for (var i = 0; i < byClass.length; i++) {
      var cm = byClass[i].CodeMirror;
      if (cm) f(cm);
    }
  }

  var globalsRegistered = false;
  function ensureGlobalHandlers() {
    if (globalsRegistered) return;
    registerGlobalHandlers();
    globalsRegistered = true;
  }
  function registerGlobalHandlers() {
    // When the window resizes, we need to refresh active editors.
    var resizeTimer;
    on(window, "resize", function() {
      if (resizeTimer == null) resizeTimer = setTimeout(function() {
        resizeTimer = null;
        forEachCodeMirror(onResize);
      }, 100);
    });
    // When the window loses focus, we want to show the editor as blurred
    on(window, "blur", function() {
      forEachCodeMirror(onBlur);
    });
  }

  // FEATURE DETECTION

  // Detect drag-and-drop
  var dragAndDrop = function() {
    // There is *some* kind of drag-and-drop support in IE6-8, but I
    // couldn't get it to work yet.
    if (ie && ie_version < 9) return false;
    var div = elt('div');
    return "draggable" in div || "dragDrop" in div;
  }();

  var zwspSupported;
  function zeroWidthElement(measure) {
    if (zwspSupported == null) {
      var test = elt("span", "\u200b");
      removeChildrenAndAdd(measure, elt("span", [test, document.createTextNode("x")]));
      if (measure.firstChild.offsetHeight != 0)
        zwspSupported = test.offsetWidth <= 1 && test.offsetHeight > 2 && !(ie && ie_version < 8);
    }
    var node = zwspSupported ? elt("span", "\u200b") :
      elt("span", "\u00a0", null, "display: inline-block; width: 1px; margin-right: -1px");
    node.setAttribute("cm-text", "");
    return node;
  }

  // Feature-detect IE's crummy client rect reporting for bidi text
  var badBidiRects;
  function hasBadBidiRects(measure) {
    if (badBidiRects != null) return badBidiRects;
    var txt = removeChildrenAndAdd(measure, document.createTextNode("A\u062eA"));
    var r0 = range(txt, 0, 1).getBoundingClientRect();
    if (!r0 || r0.left == r0.right) return false; // Safari returns null in some cases (#2780)
    var r1 = range(txt, 1, 2).getBoundingClientRect();
    return badBidiRects = (r1.right - r0.right < 3);
  }

  // See if "".split is the broken IE version, if so, provide an
  // alternative way to split lines.
  var splitLinesAuto = CodeMirror.splitLines = "\n\nb".split(/\n/).length != 3 ? function(string) {
    var pos = 0, result = [], l = string.length;
    while (pos <= l) {
      var nl = string.indexOf("\n", pos);
      if (nl == -1) nl = string.length;
      var line = string.slice(pos, string.charAt(nl - 1) == "\r" ? nl - 1 : nl);
      var rt = line.indexOf("\r");
      if (rt != -1) {
        result.push(line.slice(0, rt));
        pos += rt + 1;
      } else {
        result.push(line);
        pos = nl + 1;
      }
    }
    return result;
  } : function(string){return string.split(/\r\n?|\n/);};

  var hasSelection = window.getSelection ? function(te) {
    try { return te.selectionStart != te.selectionEnd; }
    catch(e) { return false; }
  } : function(te) {
    try {var range = te.ownerDocument.selection.createRange();}
    catch(e) {}
    if (!range || range.parentElement() != te) return false;
    return range.compareEndPoints("StartToEnd", range) != 0;
  };

  var hasCopyEvent = (function() {
    var e = elt("div");
    if ("oncopy" in e) return true;
    e.setAttribute("oncopy", "return;");
    return typeof e.oncopy == "function";
  })();

  var badZoomedRects = null;
  function hasBadZoomedRects(measure) {
    if (badZoomedRects != null) return badZoomedRects;
    var node = removeChildrenAndAdd(measure, elt("span", "x"));
    var normal = node.getBoundingClientRect();
    var fromRange = range(node, 0, 1).getBoundingClientRect();
    return badZoomedRects = Math.abs(normal.left - fromRange.left) > 1;
  }

  // KEY NAMES

  var keyNames = CodeMirror.keyNames = {
    3: "Enter", 8: "Backspace", 9: "Tab", 13: "Enter", 16: "Shift", 17: "Ctrl", 18: "Alt",
    19: "Pause", 20: "CapsLock", 27: "Esc", 32: "Space", 33: "PageUp", 34: "PageDown", 35: "End",
    36: "Home", 37: "Left", 38: "Up", 39: "Right", 40: "Down", 44: "PrintScrn", 45: "Insert",
    46: "Delete", 59: ";", 61: "=", 91: "Mod", 92: "Mod", 93: "Mod",
    106: "*", 107: "=", 109: "-", 110: ".", 111: "/", 127: "Delete",
    173: "-", 186: ";", 187: "=", 188: ",", 189: "-", 190: ".", 191: "/", 192: "`", 219: "[", 220: "\\",
    221: "]", 222: "'", 63232: "Up", 63233: "Down", 63234: "Left", 63235: "Right", 63272: "Delete",
    63273: "Home", 63275: "End", 63276: "PageUp", 63277: "PageDown", 63302: "Insert"
  };
  (function() {
    // Number keys
    for (var i = 0; i < 10; i++) keyNames[i + 48] = keyNames[i + 96] = String(i);
    // Alphabetic keys
    for (var i = 65; i <= 90; i++) keyNames[i] = String.fromCharCode(i);
    // Function keys
    for (var i = 1; i <= 12; i++) keyNames[i + 111] = keyNames[i + 63235] = "F" + i;
  })();

  // BIDI HELPERS

  function iterateBidiSections(order, from, to, f) {
    if (!order) return f(from, to, "ltr");
    var found = false;
    for (var i = 0; i < order.length; ++i) {
      var part = order[i];
      if (part.from < to && part.to > from || from == to && part.to == from) {
        f(Math.max(part.from, from), Math.min(part.to, to), part.level == 1 ? "rtl" : "ltr");
        found = true;
      }
    }
    if (!found) f(from, to, "ltr");
  }

  function bidiLeft(part) { return part.level % 2 ? part.to : part.from; }
  function bidiRight(part) { return part.level % 2 ? part.from : part.to; }

  function lineLeft(line) { var order = getOrder(line); return order ? bidiLeft(order[0]) : 0; }
  function lineRight(line) {
    var order = getOrder(line);
    if (!order) return line.text.length;
    return bidiRight(lst(order));
  }

  function lineStart(cm, lineN) {
    var line = getLine(cm.doc, lineN);
    var visual = visualLine(line);
    if (visual != line) lineN = lineNo(visual);
    var order = getOrder(visual);
    var ch = !order ? 0 : order[0].level % 2 ? lineRight(visual) : lineLeft(visual);
    return Pos(lineN, ch);
  }
  function lineEnd(cm, lineN) {
    var merged, line = getLine(cm.doc, lineN);
    while (merged = collapsedSpanAtEnd(line)) {
      line = merged.find(1, true).line;
      lineN = null;
    }
    var order = getOrder(line);
    var ch = !order ? line.text.length : order[0].level % 2 ? lineLeft(line) : lineRight(line);
    return Pos(lineN == null ? lineNo(line) : lineN, ch);
  }
  function lineStartSmart(cm, pos) {
    var start = lineStart(cm, pos.line);
    var line = getLine(cm.doc, start.line);
    var order = getOrder(line);
    if (!order || order[0].level == 0) {
      var firstNonWS = Math.max(0, line.text.search(/\S/));
      var inWS = pos.line == start.line && pos.ch <= firstNonWS && pos.ch;
      return Pos(start.line, inWS ? 0 : firstNonWS);
    }
    return start;
  }

  function compareBidiLevel(order, a, b) {
    var linedir = order[0].level;
    if (a == linedir) return true;
    if (b == linedir) return false;
    return a < b;
  }
  var bidiOther;
  function getBidiPartAt(order, pos) {
    bidiOther = null;
    for (var i = 0, found; i < order.length; ++i) {
      var cur = order[i];
      if (cur.from < pos && cur.to > pos) return i;
      if ((cur.from == pos || cur.to == pos)) {
        if (found == null) {
          found = i;
        } else if (compareBidiLevel(order, cur.level, order[found].level)) {
          if (cur.from != cur.to) bidiOther = found;
          return i;
        } else {
          if (cur.from != cur.to) bidiOther = i;
          return found;
        }
      }
    }
    return found;
  }

  function moveInLine(line, pos, dir, byUnit) {
    if (!byUnit) return pos + dir;
    do pos += dir;
    while (pos > 0 && isExtendingChar(line.text.charAt(pos)));
    return pos;
  }

  // This is needed in order to move 'visually' through bi-directional
  // text -- i.e., pressing left should make the cursor go left, even
  // when in RTL text. The tricky part is the 'jumps', where RTL and
  // LTR text touch each other. This often requires the cursor offset
  // to move more than one unit, in order to visually move one unit.
  function moveVisually(line, start, dir, byUnit) {
    var bidi = getOrder(line);
    if (!bidi) return moveLogically(line, start, dir, byUnit);
    var pos = getBidiPartAt(bidi, start), part = bidi[pos];
    var target = moveInLine(line, start, part.level % 2 ? -dir : dir, byUnit);

    for (;;) {
      if (target > part.from && target < part.to) return target;
      if (target == part.from || target == part.to) {
        if (getBidiPartAt(bidi, target) == pos) return target;
        part = bidi[pos += dir];
        return (dir > 0) == part.level % 2 ? part.to : part.from;
      } else {
        part = bidi[pos += dir];
        if (!part) return null;
        if ((dir > 0) == part.level % 2)
          target = moveInLine(line, part.to, -1, byUnit);
        else
          target = moveInLine(line, part.from, 1, byUnit);
      }
    }
  }

  function moveLogically(line, start, dir, byUnit) {
    var target = start + dir;
    if (byUnit) while (target > 0 && isExtendingChar(line.text.charAt(target))) target += dir;
    return target < 0 || target > line.text.length ? null : target;
  }

  // Bidirectional ordering algorithm
  // See http://unicode.org/reports/tr9/tr9-13.html for the algorithm
  // that this (partially) implements.

  // One-char codes used for character types:
  // L (L):   Left-to-Right
  // R (R):   Right-to-Left
  // r (AL):  Right-to-Left Arabic
  // 1 (EN):  European Number
  // + (ES):  European Number Separator
  // % (ET):  European Number Terminator
  // n (AN):  Arabic Number
  // , (CS):  Common Number Separator
  // m (NSM): Non-Spacing Mark
  // b (BN):  Boundary Neutral
  // s (B):   Paragraph Separator
  // t (S):   Segment Separator
  // w (WS):  Whitespace
  // N (ON):  Other Neutrals

  // Returns null if characters are ordered as they appear
  // (left-to-right), or an array of sections ({from, to, level}
  // objects) in the order in which they occur visually.
  var bidiOrdering = (function() {
    // Character types for codepoints 0 to 0xff
    var lowTypes = "bbbbbbbbbtstwsbbbbbbbbbbbbbbssstwNN%%%NNNNNN,N,N1111111111NNNNNNNLLLLLLLLLLLLLLLLLLLLLLLLLLNNNNNNLLLLLLLLLLLLLLLLLLLLLLLLLLNNNNbbbbbbsbbbbbbbbbbbbbbbbbbbbbbbbbb,N%%%%NNNNLNNNNN%%11NLNNN1LNNNNNLLLLLLLLLLLLLLLLLLLLLLLNLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLN";
    // Character types for codepoints 0x600 to 0x6ff
    var arabicTypes = "rrrrrrrrrrrr,rNNmmmmmmrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrmmmmmmmmmmmmmmrrrrrrrnnnnnnnnnn%nnrrrmrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrmmmmmmmmmmmmmmmmmmmNmmmm";
    function charType(code) {
      if (code <= 0xf7) return lowTypes.charAt(code);
      else if (0x590 <= code && code <= 0x5f4) return "R";
      else if (0x600 <= code && code <= 0x6ed) return arabicTypes.charAt(code - 0x600);
      else if (0x6ee <= code && code <= 0x8ac) return "r";
      else if (0x2000 <= code && code <= 0x200b) return "w";
      else if (code == 0x200c) return "b";
      else return "L";
    }

    var bidiRE = /[\u0590-\u05f4\u0600-\u06ff\u0700-\u08ac]/;
    var isNeutral = /[stwN]/, isStrong = /[LRr]/, countsAsLeft = /[Lb1n]/, countsAsNum = /[1n]/;
    // Browsers seem to always treat the boundaries of block elements as being L.
    var outerType = "L";

    function BidiSpan(level, from, to) {
      this.level = level;
      this.from = from; this.to = to;
    }

    return function(str) {
      if (!bidiRE.test(str)) return false;
      var len = str.length, types = [];
      for (var i = 0, type; i < len; ++i)
        types.push(type = charType(str.charCodeAt(i)));

      // W1. Examine each non-spacing mark (NSM) in the level run, and
      // change the type of the NSM to the type of the previous
      // character. If the NSM is at the start of the level run, it will
      // get the type of sor.
      for (var i = 0, prev = outerType; i < len; ++i) {
        var type = types[i];
        if (type == "m") types[i] = prev;
        else prev = type;
      }

      // W2. Search backwards from each instance of a European number
      // until the first strong type (R, L, AL, or sor) is found. If an
      // AL is found, change the type of the European number to Arabic
      // number.
      // W3. Change all ALs to R.
      for (var i = 0, cur = outerType; i < len; ++i) {
        var type = types[i];
        if (type == "1" && cur == "r") types[i] = "n";
        else if (isStrong.test(type)) { cur = type; if (type == "r") types[i] = "R"; }
      }

      // W4. A single European separator between two European numbers
      // changes to a European number. A single common separator between
      // two numbers of the same type changes to that type.
      for (var i = 1, prev = types[0]; i < len - 1; ++i) {
        var type = types[i];
        if (type == "+" && prev == "1" && types[i+1] == "1") types[i] = "1";
        else if (type == "," && prev == types[i+1] &&
                 (prev == "1" || prev == "n")) types[i] = prev;
        prev = type;
      }

      // W5. A sequence of European terminators adjacent to European
      // numbers changes to all European numbers.
      // W6. Otherwise, separators and terminators change to Other
      // Neutral.
      for (var i = 0; i < len; ++i) {
        var type = types[i];
        if (type == ",") types[i] = "N";
        else if (type == "%") {
          for (var end = i + 1; end < len && types[end] == "%"; ++end) {}
          var replace = (i && types[i-1] == "!") || (end < len && types[end] == "1") ? "1" : "N";
          for (var j = i; j < end; ++j) types[j] = replace;
          i = end - 1;
        }
      }

      // W7. Search backwards from each instance of a European number
      // until the first strong type (R, L, or sor) is found. If an L is
      // found, then change the type of the European number to L.
      for (var i = 0, cur = outerType; i < len; ++i) {
        var type = types[i];
        if (cur == "L" && type == "1") types[i] = "L";
        else if (isStrong.test(type)) cur = type;
      }

      // N1. A sequence of neutrals takes the direction of the
      // surrounding strong text if the text on both sides has the same
      // direction. European and Arabic numbers act as if they were R in
      // terms of their influence on neutrals. Start-of-level-run (sor)
      // and end-of-level-run (eor) are used at level run boundaries.
      // N2. Any remaining neutrals take the embedding direction.
      for (var i = 0; i < len; ++i) {
        if (isNeutral.test(types[i])) {
          for (var end = i + 1; end < len && isNeutral.test(types[end]); ++end) {}
          var before = (i ? types[i-1] : outerType) == "L";
          var after = (end < len ? types[end] : outerType) == "L";
          var replace = before || after ? "L" : "R";
          for (var j = i; j < end; ++j) types[j] = replace;
          i = end - 1;
        }
      }

      // Here we depart from the documented algorithm, in order to avoid
      // building up an actual levels array. Since there are only three
      // levels (0, 1, 2) in an implementation that doesn't take
      // explicit embedding into account, we can build up the order on
      // the fly, without following the level-based algorithm.
      var order = [], m;
      for (var i = 0; i < len;) {
        if (countsAsLeft.test(types[i])) {
          var start = i;
          for (++i; i < len && countsAsLeft.test(types[i]); ++i) {}
          order.push(new BidiSpan(0, start, i));
        } else {
          var pos = i, at = order.length;
          for (++i; i < len && types[i] != "L"; ++i) {}
          for (var j = pos; j < i;) {
            if (countsAsNum.test(types[j])) {
              if (pos < j) order.splice(at, 0, new BidiSpan(1, pos, j));
              var nstart = j;
              for (++j; j < i && countsAsNum.test(types[j]); ++j) {}
              order.splice(at, 0, new BidiSpan(2, nstart, j));
              pos = j;
            } else ++j;
          }
          if (pos < i) order.splice(at, 0, new BidiSpan(1, pos, i));
        }
      }
      if (order[0].level == 1 && (m = str.match(/^\s+/))) {
        order[0].from = m[0].length;
        order.unshift(new BidiSpan(0, 0, m[0].length));
      }
      if (lst(order).level == 1 && (m = str.match(/\s+$/))) {
        lst(order).to -= m[0].length;
        order.push(new BidiSpan(0, len - m[0].length, len));
      }
      if (order[0].level == 2)
        order.unshift(new BidiSpan(1, order[0].to, order[0].to));
      if (order[0].level != lst(order).level)
        order.push(new BidiSpan(order[0].level, len, len));

      return order;
    };
  })();

  // THE END

  CodeMirror.version = "5.8.0";

  return CodeMirror;
});

},{}],3:[function(require,module,exports){
// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE

/**
 * Author: Hans Engel
 * Branched from CodeMirror's Scheme mode (by Koh Zi Han, based on implementation by Koh Zi Chun)
 */

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    mod(require("../../lib/codemirror"));
  else if (typeof define == "function" && define.amd) // AMD
    define(["../../lib/codemirror"], mod);
  else // Plain browser env
    mod(CodeMirror);
})(function(CodeMirror) {
"use strict";

CodeMirror.defineMode("clojure", function (options) {
    var BUILTIN = "builtin", COMMENT = "comment", STRING = "string", CHARACTER = "string-2",
        ATOM = "atom", NUMBER = "number", BRACKET = "bracket", KEYWORD = "keyword", VAR = "variable";
    var INDENT_WORD_SKIP = options.indentUnit || 2;
    var NORMAL_INDENT_UNIT = options.indentUnit || 2;

    function makeKeywords(str) {
        var obj = {}, words = str.split(" ");
        for (var i = 0; i < words.length; ++i) obj[words[i]] = true;
        return obj;
    }

    var atoms = makeKeywords("true false nil");

    var keywords = makeKeywords(
      "defn defn- def def- defonce defmulti defmethod defmacro defstruct deftype defprotocol defrecord defproject deftest slice defalias defhinted defmacro- defn-memo defnk defnk defonce- defunbound defunbound- defvar defvar- let letfn do case cond condp for loop recur when when-not when-let when-first if if-let if-not . .. -> ->> doto and or dosync doseq dotimes dorun doall load import unimport ns in-ns refer try catch finally throw with-open with-local-vars binding gen-class gen-and-load-class gen-and-save-class handler-case handle");

    var builtins = makeKeywords(
        "* *' *1 *2 *3 *agent* *allow-unresolved-vars* *assert* *clojure-version* *command-line-args* *compile-files* *compile-path* *compiler-options* *data-readers* *e *err* *file* *flush-on-newline* *fn-loader* *in* *math-context* *ns* *out* *print-dup* *print-length* *print-level* *print-meta* *print-readably* *read-eval* *source-path* *unchecked-math* *use-context-classloader* *verbose-defrecords* *warn-on-reflection* + +' - -' -> ->> ->ArrayChunk ->Vec ->VecNode ->VecSeq -cache-protocol-fn -reset-methods .. / < <= = == > >= EMPTY-NODE accessor aclone add-classpath add-watch agent agent-error agent-errors aget alength alias all-ns alter alter-meta! alter-var-root amap ancestors and apply areduce array-map aset aset-boolean aset-byte aset-char aset-double aset-float aset-int aset-long aset-short assert assoc assoc! assoc-in associative? atom await await-for await1 bases bean bigdec bigint biginteger binding bit-and bit-and-not bit-clear bit-flip bit-not bit-or bit-set bit-shift-left bit-shift-right bit-test bit-xor boolean boolean-array booleans bound-fn bound-fn* bound? butlast byte byte-array bytes case cast char char-array char-escape-string char-name-string char? chars chunk chunk-append chunk-buffer chunk-cons chunk-first chunk-next chunk-rest chunked-seq? class class? clear-agent-errors clojure-version coll? comment commute comp comparator compare compare-and-set! compile complement concat cond condp conj conj! cons constantly construct-proxy contains? count counted? create-ns create-struct cycle dec dec' decimal? declare default-data-readers definline definterface defmacro defmethod defmulti defn defn- defonce defprotocol defrecord defstruct deftype delay delay? deliver denominator deref derive descendants destructure disj disj! dissoc dissoc! distinct distinct? doall dorun doseq dosync dotimes doto double double-array doubles drop drop-last drop-while empty empty? ensure enumeration-seq error-handler error-mode eval even? every-pred every? ex-data ex-info extend extend-protocol extend-type extenders extends? false? ffirst file-seq filter filterv find find-keyword find-ns find-protocol-impl find-protocol-method find-var first flatten float float-array float? floats flush fn fn? fnext fnil for force format frequencies future future-call future-cancel future-cancelled? future-done? future? gen-class gen-interface gensym get get-in get-method get-proxy-class get-thread-bindings get-validator group-by hash hash-combine hash-map hash-set identical? identity if-let if-not ifn? import in-ns inc inc' init-proxy instance? int int-array integer? interleave intern interpose into into-array ints io! isa? iterate iterator-seq juxt keep keep-indexed key keys keyword keyword? last lazy-cat lazy-seq let letfn line-seq list list* list? load load-file load-reader load-string loaded-libs locking long long-array longs loop macroexpand macroexpand-1 make-array make-hierarchy map map-indexed map? mapcat mapv max max-key memfn memoize merge merge-with meta method-sig methods min min-key mod munge name namespace namespace-munge neg? newline next nfirst nil? nnext not not-any? not-empty not-every? not= ns ns-aliases ns-imports ns-interns ns-map ns-name ns-publics ns-refers ns-resolve ns-unalias ns-unmap nth nthnext nthrest num number? numerator object-array odd? or parents partial partition partition-all partition-by pcalls peek persistent! pmap pop pop! pop-thread-bindings pos? pr pr-str prefer-method prefers primitives-classnames print print-ctor print-dup print-method print-simple print-str printf println println-str prn prn-str promise proxy proxy-call-with-super proxy-mappings proxy-name proxy-super push-thread-bindings pvalues quot rand rand-int rand-nth range ratio? rational? rationalize re-find re-groups re-matcher re-matches re-pattern re-seq read read-line read-string realized? reduce reduce-kv reductions ref ref-history-count ref-max-history ref-min-history ref-set refer refer-clojure reify release-pending-sends rem remove remove-all-methods remove-method remove-ns remove-watch repeat repeatedly replace replicate require reset! reset-meta! resolve rest restart-agent resultset-seq reverse reversible? rseq rsubseq satisfies? second select-keys send send-off seq seq? seque sequence sequential? set set-error-handler! set-error-mode! set-validator! set? short short-array shorts shuffle shutdown-agents slurp some some-fn sort sort-by sorted-map sorted-map-by sorted-set sorted-set-by sorted? special-symbol? spit split-at split-with str string? struct struct-map subs subseq subvec supers swap! symbol symbol? sync take take-last take-nth take-while test the-ns thread-bound? time to-array to-array-2d trampoline transient tree-seq true? type unchecked-add unchecked-add-int unchecked-byte unchecked-char unchecked-dec unchecked-dec-int unchecked-divide-int unchecked-double unchecked-float unchecked-inc unchecked-inc-int unchecked-int unchecked-long unchecked-multiply unchecked-multiply-int unchecked-negate unchecked-negate-int unchecked-remainder-int unchecked-short unchecked-subtract unchecked-subtract-int underive unquote unquote-splicing update-in update-proxy use val vals var-get var-set var? vary-meta vec vector vector-of vector? when when-first when-let when-not while with-bindings with-bindings* with-in-str with-loading-context with-local-vars with-meta with-open with-out-str with-precision with-redefs with-redefs-fn xml-seq zero? zipmap *default-data-reader-fn* as-> cond-> cond->> reduced reduced? send-via set-agent-send-executor! set-agent-send-off-executor! some-> some->>");

    var indentKeys = makeKeywords(
        // Built-ins
        "ns fn def defn defmethod bound-fn if if-not case condp when while when-not when-first do future comment doto locking proxy with-open with-precision reify deftype defrecord defprotocol extend extend-protocol extend-type try catch " +

        // Binding forms
        "let letfn binding loop for doseq dotimes when-let if-let " +

        // Data structures
        "defstruct struct-map assoc " +

        // clojure.test
        "testing deftest " +

        // contrib
        "handler-case handle dotrace deftrace");

    var tests = {
        digit: /\d/,
        digit_or_colon: /[\d:]/,
        hex: /[0-9a-f]/i,
        sign: /[+-]/,
        exponent: /e/i,
        keyword_char: /[^\s\(\[\;\)\]]/,
        symbol: /[\w*+!\-\._?:<>\/\xa1-\uffff]/
    };

    function stateStack(indent, type, prev) { // represents a state stack object
        this.indent = indent;
        this.type = type;
        this.prev = prev;
    }

    function pushStack(state, indent, type) {
        state.indentStack = new stateStack(indent, type, state.indentStack);
    }

    function popStack(state) {
        state.indentStack = state.indentStack.prev;
    }

    function isNumber(ch, stream){
        // hex
        if ( ch === '0' && stream.eat(/x/i) ) {
            stream.eatWhile(tests.hex);
            return true;
        }

        // leading sign
        if ( ( ch == '+' || ch == '-' ) && ( tests.digit.test(stream.peek()) ) ) {
          stream.eat(tests.sign);
          ch = stream.next();
        }

        if ( tests.digit.test(ch) ) {
            stream.eat(ch);
            stream.eatWhile(tests.digit);

            if ( '.' == stream.peek() ) {
                stream.eat('.');
                stream.eatWhile(tests.digit);
            }

            if ( stream.eat(tests.exponent) ) {
                stream.eat(tests.sign);
                stream.eatWhile(tests.digit);
            }

            return true;
        }

        return false;
    }

    // Eat character that starts after backslash \
    function eatCharacter(stream) {
        var first = stream.next();
        // Read special literals: backspace, newline, space, return.
        // Just read all lowercase letters.
        if (first && first.match(/[a-z]/) && stream.match(/[a-z]+/, true)) {
            return;
        }
        // Read unicode character: \u1000 \uA0a1
        if (first === "u") {
            stream.match(/[0-9a-z]{4}/i, true);
        }
    }

    return {
        startState: function () {
            return {
                indentStack: null,
                indentation: 0,
                mode: false
            };
        },

        token: function (stream, state) {
            if (state.indentStack == null && stream.sol()) {
                // update indentation, but only if indentStack is empty
                state.indentation = stream.indentation();
            }

            // skip spaces
            if (stream.eatSpace()) {
                return null;
            }
            var returnType = null;

            switch(state.mode){
                case "string": // multi-line string parsing mode
                    var next, escaped = false;
                    while ((next = stream.next()) != null) {
                        if (next == "\"" && !escaped) {

                            state.mode = false;
                            break;
                        }
                        escaped = !escaped && next == "\\";
                    }
                    returnType = STRING; // continue on in string mode
                    break;
                default: // default parsing mode
                    var ch = stream.next();

                    if (ch == "\"") {
                        state.mode = "string";
                        returnType = STRING;
                    } else if (ch == "\\") {
                        eatCharacter(stream);
                        returnType = CHARACTER;
                    } else if (ch == "'" && !( tests.digit_or_colon.test(stream.peek()) )) {
                        returnType = ATOM;
                    } else if (ch == ";") { // comment
                        stream.skipToEnd(); // rest of the line is a comment
                        returnType = COMMENT;
                    } else if (isNumber(ch,stream)){
                        returnType = NUMBER;
                    } else if (ch == "(" || ch == "[" || ch == "{" ) {
                        var keyWord = '', indentTemp = stream.column(), letter;
                        /**
                        Either
                        (indent-word ..
                        (non-indent-word ..
                        (;something else, bracket, etc.
                        */

                        if (ch == "(") while ((letter = stream.eat(tests.keyword_char)) != null) {
                            keyWord += letter;
                        }

                        if (keyWord.length > 0 && (indentKeys.propertyIsEnumerable(keyWord) ||
                                                   /^(?:def|with)/.test(keyWord))) { // indent-word
                            pushStack(state, indentTemp + INDENT_WORD_SKIP, ch);
                        } else { // non-indent word
                            // we continue eating the spaces
                            stream.eatSpace();
                            if (stream.eol() || stream.peek() == ";") {
                                // nothing significant after
                                // we restart indentation the user defined spaces after
                                pushStack(state, indentTemp + NORMAL_INDENT_UNIT, ch);
                            } else {
                                pushStack(state, indentTemp + stream.current().length, ch); // else we match
                            }
                        }
                        stream.backUp(stream.current().length - 1); // undo all the eating

                        returnType = BRACKET;
                    } else if (ch == ")" || ch == "]" || ch == "}") {
                        returnType = BRACKET;
                        if (state.indentStack != null && state.indentStack.type == (ch == ")" ? "(" : (ch == "]" ? "[" :"{"))) {
                            popStack(state);
                        }
                    } else if ( ch == ":" ) {
                        stream.eatWhile(tests.symbol);
                        return ATOM;
                    } else {
                        stream.eatWhile(tests.symbol);

                        if (keywords && keywords.propertyIsEnumerable(stream.current())) {
                            returnType = KEYWORD;
                        } else if (builtins && builtins.propertyIsEnumerable(stream.current())) {
                            returnType = BUILTIN;
                        } else if (atoms && atoms.propertyIsEnumerable(stream.current())) {
                            returnType = ATOM;
                        } else {
                          returnType = VAR;
                        }
                    }
            }

            return returnType;
        },

        indent: function (state) {
            if (state.indentStack == null) return state.indentation;
            return state.indentStack.indent;
        },

        closeBrackets: {pairs: "()[]{}\"\""},
        lineComment: ";;"
    };
});

CodeMirror.defineMIME("text/x-clojure", "clojure");

});

},{"../../lib/codemirror":2}],4:[function(require,module,exports){
// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    mod(require("../../lib/codemirror"), require("../markdown/markdown"), require("../../addon/mode/overlay"));
  else if (typeof define == "function" && define.amd) // AMD
    define(["../../lib/codemirror", "../markdown/markdown", "../../addon/mode/overlay"], mod);
  else // Plain browser env
    mod(CodeMirror);
})(function(CodeMirror) {
"use strict";

var urlRE = /^((?:(?:aaas?|about|acap|adiumxtra|af[ps]|aim|apt|attachment|aw|beshare|bitcoin|bolo|callto|cap|chrome(?:-extension)?|cid|coap|com-eventbrite-attendee|content|crid|cvs|data|dav|dict|dlna-(?:playcontainer|playsingle)|dns|doi|dtn|dvb|ed2k|facetime|feed|file|finger|fish|ftp|geo|gg|git|gizmoproject|go|gopher|gtalk|h323|hcp|https?|iax|icap|icon|im|imap|info|ipn|ipp|irc[6s]?|iris(?:\.beep|\.lwz|\.xpc|\.xpcs)?|itms|jar|javascript|jms|keyparc|lastfm|ldaps?|magnet|mailto|maps|market|message|mid|mms|ms-help|msnim|msrps?|mtqp|mumble|mupdate|mvn|news|nfs|nih?|nntp|notes|oid|opaquelocktoken|palm|paparazzi|platform|pop|pres|proxy|psyc|query|res(?:ource)?|rmi|rsync|rtmp|rtsp|secondlife|service|session|sftp|sgn|shttp|sieve|sips?|skype|sm[bs]|snmp|soap\.beeps?|soldat|spotify|ssh|steam|svn|tag|teamspeak|tel(?:net)?|tftp|things|thismessage|tip|tn3270|tv|udp|unreal|urn|ut2004|vemmi|ventrilo|view-source|webcal|wss?|wtai|wyciwyg|xcon(?:-userid)?|xfire|xmlrpc\.beeps?|xmpp|xri|ymsgr|z39\.50[rs]?):(?:\/{1,3}|[a-z0-9%])|www\d{0,3}[.]|[a-z0-9.\-]+[.][a-z]{2,4}\/)(?:[^\s()<>]|\([^\s()<>]*\))+(?:\([^\s()<>]*\)|[^\s`*!()\[\]{};:'".,<>?«»“”‘’]))/i

CodeMirror.defineMode("gfm", function(config, modeConfig) {
  var codeDepth = 0;
  function blankLine(state) {
    state.code = false;
    return null;
  }
  var gfmOverlay = {
    startState: function() {
      return {
        code: false,
        codeBlock: false,
        ateSpace: false
      };
    },
    copyState: function(s) {
      return {
        code: s.code,
        codeBlock: s.codeBlock,
        ateSpace: s.ateSpace
      };
    },
    token: function(stream, state) {
      state.combineTokens = null;

      // Hack to prevent formatting override inside code blocks (block and inline)
      if (state.codeBlock) {
        if (stream.match(/^```+/)) {
          state.codeBlock = false;
          return null;
        }
        stream.skipToEnd();
        return null;
      }
      if (stream.sol()) {
        state.code = false;
      }
      if (stream.sol() && stream.match(/^```+/)) {
        stream.skipToEnd();
        state.codeBlock = true;
        return null;
      }
      // If this block is changed, it may need to be updated in Markdown mode
      if (stream.peek() === '`') {
        stream.next();
        var before = stream.pos;
        stream.eatWhile('`');
        var difference = 1 + stream.pos - before;
        if (!state.code) {
          codeDepth = difference;
          state.code = true;
        } else {
          if (difference === codeDepth) { // Must be exact
            state.code = false;
          }
        }
        return null;
      } else if (state.code) {
        stream.next();
        return null;
      }
      // Check if space. If so, links can be formatted later on
      if (stream.eatSpace()) {
        state.ateSpace = true;
        return null;
      }
      if (stream.sol() || state.ateSpace) {
        state.ateSpace = false;
        if (modeConfig.gitHubSpice !== false) {
          if(stream.match(/^(?:[a-zA-Z0-9\-_]+\/)?(?:[a-zA-Z0-9\-_]+@)?(?:[a-f0-9]{7,40}\b)/)) {
            // User/Project@SHA
            // User@SHA
            // SHA
            state.combineTokens = true;
            return "link";
          } else if (stream.match(/^(?:[a-zA-Z0-9\-_]+\/)?(?:[a-zA-Z0-9\-_]+)?#[0-9]+\b/)) {
            // User/Project#Num
            // User#Num
            // #Num
            state.combineTokens = true;
            return "link";
          }
        }
      }
      if (stream.match(urlRE) &&
          stream.string.slice(stream.start - 2, stream.start) != "](" &&
          (stream.start == 0 || /\W/.test(stream.string.charAt(stream.start - 1)))) {
        // URLs
        // Taken from http://daringfireball.net/2010/07/improved_regex_for_matching_urls
        // And then (issue #1160) simplified to make it not crash the Chrome Regexp engine
        // And then limited url schemes to the CommonMark list, so foo:bar isn't matched as a URL
        state.combineTokens = true;
        return "link";
      }
      stream.next();
      return null;
    },
    blankLine: blankLine
  };

  var markdownConfig = {
    underscoresBreakWords: false,
    taskLists: true,
    fencedCodeBlocks: '```',
    strikethrough: true
  };
  for (var attr in modeConfig) {
    markdownConfig[attr] = modeConfig[attr];
  }
  markdownConfig.name = "markdown";
  return CodeMirror.overlayMode(CodeMirror.getMode(config, markdownConfig), gfmOverlay);

}, "markdown");

  CodeMirror.defineMIME("text/x-gfm", "gfm");
});

},{"../../addon/mode/overlay":1,"../../lib/codemirror":2,"../markdown/markdown":5}],5:[function(require,module,exports){
// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    mod(require("../../lib/codemirror"), require("../xml/xml"), require("../meta"));
  else if (typeof define == "function" && define.amd) // AMD
    define(["../../lib/codemirror", "../xml/xml", "../meta"], mod);
  else // Plain browser env
    mod(CodeMirror);
})(function(CodeMirror) {
"use strict";

CodeMirror.defineMode("markdown", function(cmCfg, modeCfg) {

  var htmlFound = CodeMirror.modes.hasOwnProperty("xml");
  var htmlMode = CodeMirror.getMode(cmCfg, htmlFound ? {name: "xml", htmlMode: true} : "text/plain");

  function getMode(name) {
    if (CodeMirror.findModeByName) {
      var found = CodeMirror.findModeByName(name);
      if (found) name = found.mime || found.mimes[0];
    }
    var mode = CodeMirror.getMode(cmCfg, name);
    return mode.name == "null" ? null : mode;
  }

  // Should characters that affect highlighting be highlighted separate?
  // Does not include characters that will be output (such as `1.` and `-` for lists)
  if (modeCfg.highlightFormatting === undefined)
    modeCfg.highlightFormatting = false;

  // Maximum number of nested blockquotes. Set to 0 for infinite nesting.
  // Excess `>` will emit `error` token.
  if (modeCfg.maxBlockquoteDepth === undefined)
    modeCfg.maxBlockquoteDepth = 0;

  // Should underscores in words open/close em/strong?
  if (modeCfg.underscoresBreakWords === undefined)
    modeCfg.underscoresBreakWords = true;

  // Use `fencedCodeBlocks` to configure fenced code blocks. false to
  // disable, string to specify a precise regexp that the fence should
  // match, and true to allow three or more backticks or tildes (as
  // per CommonMark).

  // Turn on task lists? ("- [ ] " and "- [x] ")
  if (modeCfg.taskLists === undefined) modeCfg.taskLists = false;

  // Turn on strikethrough syntax
  if (modeCfg.strikethrough === undefined)
    modeCfg.strikethrough = false;

  // Allow token types to be overridden by user-provided token types.
  if (modeCfg.tokenTypeOverrides === undefined)
    modeCfg.tokenTypeOverrides = {};

  var codeDepth = 0;

  var tokenTypes = {
    header: "header",
    code: "comment",
    quote: "quote",
    list1: "variable-2",
    list2: "variable-3",
    list3: "keyword",
    hr: "hr",
    image: "tag",
    formatting: "formatting",
    linkInline: "link",
    linkEmail: "link",
    linkText: "link",
    linkHref: "string",
    em: "em",
    strong: "strong",
    strikethrough: "strikethrough"
  };

  for (var tokenType in tokenTypes) {
    if (tokenTypes.hasOwnProperty(tokenType) && modeCfg.tokenTypeOverrides[tokenType]) {
      tokenTypes[tokenType] = modeCfg.tokenTypeOverrides[tokenType];
    }
  }

  var hrRE = /^([*\-_])(?:\s*\1){2,}\s*$/
  ,   ulRE = /^[*\-+]\s+/
  ,   olRE = /^[0-9]+([.)])\s+/
  ,   taskListRE = /^\[(x| )\](?=\s)/ // Must follow ulRE or olRE
  ,   atxHeaderRE = modeCfg.allowAtxHeaderWithoutSpace ? /^(#+)/ : /^(#+)(?: |$)/
  ,   setextHeaderRE = /^ *(?:\={1,}|-{1,})\s*$/
  ,   textRE = /^[^#!\[\]*_\\<>` "'(~]+/
  ,   fencedCodeRE = new RegExp("^(" + (modeCfg.fencedCodeBlocks === true ? "~~~+|```+" : modeCfg.fencedCodeBlocks) +
                                ")[ \\t]*([\\w+#]*)");

  function switchInline(stream, state, f) {
    state.f = state.inline = f;
    return f(stream, state);
  }

  function switchBlock(stream, state, f) {
    state.f = state.block = f;
    return f(stream, state);
  }

  function lineIsEmpty(line) {
    return !line || !/\S/.test(line.string)
  }

  // Blocks

  function blankLine(state) {
    // Reset linkTitle state
    state.linkTitle = false;
    // Reset EM state
    state.em = false;
    // Reset STRONG state
    state.strong = false;
    // Reset strikethrough state
    state.strikethrough = false;
    // Reset state.quote
    state.quote = 0;
    // Reset state.indentedCode
    state.indentedCode = false;
    if (!htmlFound && state.f == htmlBlock) {
      state.f = inlineNormal;
      state.block = blockNormal;
    }
    // Reset state.trailingSpace
    state.trailingSpace = 0;
    state.trailingSpaceNewLine = false;
    // Mark this line as blank
    state.prevLine = state.thisLine
    state.thisLine = null
    return null;
  }

  function blockNormal(stream, state) {

    var sol = stream.sol();

    var prevLineIsList = state.list !== false,
        prevLineIsIndentedCode = state.indentedCode;

    state.indentedCode = false;

    if (prevLineIsList) {
      if (state.indentationDiff >= 0) { // Continued list
        if (state.indentationDiff < 4) { // Only adjust indentation if *not* a code block
          state.indentation -= state.indentationDiff;
        }
        state.list = null;
      } else if (state.indentation > 0) {
        state.list = null;
        state.listDepth = Math.floor(state.indentation / 4);
      } else { // No longer a list
        state.list = false;
        state.listDepth = 0;
      }
    }

    var match = null;
    if (state.indentationDiff >= 4) {
      stream.skipToEnd();
      if (prevLineIsIndentedCode || lineIsEmpty(state.prevLine)) {
        state.indentation -= 4;
        state.indentedCode = true;
        return tokenTypes.code;
      } else {
        return null;
      }
    } else if (stream.eatSpace()) {
      return null;
    } else if ((match = stream.match(atxHeaderRE)) && match[1].length <= 6) {
      state.header = match[1].length;
      if (modeCfg.highlightFormatting) state.formatting = "header";
      state.f = state.inline;
      return getType(state);
    } else if (!lineIsEmpty(state.prevLine) && !state.quote && !prevLineIsList &&
               !prevLineIsIndentedCode && (match = stream.match(setextHeaderRE))) {
      state.header = match[0].charAt(0) == '=' ? 1 : 2;
      if (modeCfg.highlightFormatting) state.formatting = "header";
      state.f = state.inline;
      return getType(state);
    } else if (stream.eat('>')) {
      state.quote = sol ? 1 : state.quote + 1;
      if (modeCfg.highlightFormatting) state.formatting = "quote";
      stream.eatSpace();
      return getType(state);
    } else if (stream.peek() === '[') {
      return switchInline(stream, state, footnoteLink);
    } else if (stream.match(hrRE, true)) {
      state.hr = true;
      return tokenTypes.hr;
    } else if ((lineIsEmpty(state.prevLine) || prevLineIsList) && (stream.match(ulRE, false) || stream.match(olRE, false))) {
      var listType = null;
      if (stream.match(ulRE, true)) {
        listType = 'ul';
      } else {
        stream.match(olRE, true);
        listType = 'ol';
      }
      state.indentation = stream.column() + stream.current().length;
      state.list = true;
      state.listDepth++;
      if (modeCfg.taskLists && stream.match(taskListRE, false)) {
        state.taskList = true;
      }
      state.f = state.inline;
      if (modeCfg.highlightFormatting) state.formatting = ["list", "list-" + listType];
      return getType(state);
    } else if (modeCfg.fencedCodeBlocks && (match = stream.match(fencedCodeRE, true))) {
      state.fencedChars = match[1]
      // try switching mode
      state.localMode = getMode(match[2]);
      if (state.localMode) state.localState = state.localMode.startState();
      state.f = state.block = local;
      if (modeCfg.highlightFormatting) state.formatting = "code-block";
      state.code = true;
      return getType(state);
    }

    return switchInline(stream, state, state.inline);
  }

  function htmlBlock(stream, state) {
    var style = htmlMode.token(stream, state.htmlState);
    if ((htmlFound && state.htmlState.tagStart === null &&
         (!state.htmlState.context && state.htmlState.tokenize.isInText)) ||
        (state.md_inside && stream.current().indexOf(">") > -1)) {
      state.f = inlineNormal;
      state.block = blockNormal;
      state.htmlState = null;
    }
    return style;
  }

  function local(stream, state) {
    if (stream.sol() && state.fencedChars && stream.match(state.fencedChars, false)) {
      state.localMode = state.localState = null;
      state.f = state.block = leavingLocal;
      return null;
    } else if (state.localMode) {
      return state.localMode.token(stream, state.localState);
    } else {
      stream.skipToEnd();
      return tokenTypes.code;
    }
  }

  function leavingLocal(stream, state) {
    stream.match(state.fencedChars);
    state.block = blockNormal;
    state.f = inlineNormal;
    state.fencedChars = null;
    if (modeCfg.highlightFormatting) state.formatting = "code-block";
    state.code = true;
    var returnType = getType(state);
    state.code = false;
    return returnType;
  }

  // Inline
  function getType(state) {
    var styles = [];

    if (state.formatting) {
      styles.push(tokenTypes.formatting);

      if (typeof state.formatting === "string") state.formatting = [state.formatting];

      for (var i = 0; i < state.formatting.length; i++) {
        styles.push(tokenTypes.formatting + "-" + state.formatting[i]);

        if (state.formatting[i] === "header") {
          styles.push(tokenTypes.formatting + "-" + state.formatting[i] + "-" + state.header);
        }

        // Add `formatting-quote` and `formatting-quote-#` for blockquotes
        // Add `error` instead if the maximum blockquote nesting depth is passed
        if (state.formatting[i] === "quote") {
          if (!modeCfg.maxBlockquoteDepth || modeCfg.maxBlockquoteDepth >= state.quote) {
            styles.push(tokenTypes.formatting + "-" + state.formatting[i] + "-" + state.quote);
          } else {
            styles.push("error");
          }
        }
      }
    }

    if (state.taskOpen) {
      styles.push("meta");
      return styles.length ? styles.join(' ') : null;
    }
    if (state.taskClosed) {
      styles.push("property");
      return styles.length ? styles.join(' ') : null;
    }

    if (state.linkHref) {
      styles.push(tokenTypes.linkHref, "url");
    } else { // Only apply inline styles to non-url text
      if (state.strong) { styles.push(tokenTypes.strong); }
      if (state.em) { styles.push(tokenTypes.em); }
      if (state.strikethrough) { styles.push(tokenTypes.strikethrough); }
      if (state.linkText) { styles.push(tokenTypes.linkText); }
      if (state.code) { styles.push(tokenTypes.code); }
    }

    if (state.header) { styles.push(tokenTypes.header, tokenTypes.header + "-" + state.header); }

    if (state.quote) {
      styles.push(tokenTypes.quote);

      // Add `quote-#` where the maximum for `#` is modeCfg.maxBlockquoteDepth
      if (!modeCfg.maxBlockquoteDepth || modeCfg.maxBlockquoteDepth >= state.quote) {
        styles.push(tokenTypes.quote + "-" + state.quote);
      } else {
        styles.push(tokenTypes.quote + "-" + modeCfg.maxBlockquoteDepth);
      }
    }

    if (state.list !== false) {
      var listMod = (state.listDepth - 1) % 3;
      if (!listMod) {
        styles.push(tokenTypes.list1);
      } else if (listMod === 1) {
        styles.push(tokenTypes.list2);
      } else {
        styles.push(tokenTypes.list3);
      }
    }

    if (state.trailingSpaceNewLine) {
      styles.push("trailing-space-new-line");
    } else if (state.trailingSpace) {
      styles.push("trailing-space-" + (state.trailingSpace % 2 ? "a" : "b"));
    }

    return styles.length ? styles.join(' ') : null;
  }

  function handleText(stream, state) {
    if (stream.match(textRE, true)) {
      return getType(state);
    }
    return undefined;
  }

  function inlineNormal(stream, state) {
    var style = state.text(stream, state);
    if (typeof style !== 'undefined')
      return style;

    if (state.list) { // List marker (*, +, -, 1., etc)
      state.list = null;
      return getType(state);
    }

    if (state.taskList) {
      var taskOpen = stream.match(taskListRE, true)[1] !== "x";
      if (taskOpen) state.taskOpen = true;
      else state.taskClosed = true;
      if (modeCfg.highlightFormatting) state.formatting = "task";
      state.taskList = false;
      return getType(state);
    }

    state.taskOpen = false;
    state.taskClosed = false;

    if (state.header && stream.match(/^#+$/, true)) {
      if (modeCfg.highlightFormatting) state.formatting = "header";
      return getType(state);
    }

    // Get sol() value now, before character is consumed
    var sol = stream.sol();

    var ch = stream.next();

    if (ch === '\\') {
      stream.next();
      if (modeCfg.highlightFormatting) {
        var type = getType(state);
        var formattingEscape = tokenTypes.formatting + "-escape";
        return type ? type + " " + formattingEscape : formattingEscape;
      }
    }

    // Matches link titles present on next line
    if (state.linkTitle) {
      state.linkTitle = false;
      var matchCh = ch;
      if (ch === '(') {
        matchCh = ')';
      }
      matchCh = (matchCh+'').replace(/([.?*+^$[\]\\(){}|-])/g, "\\$1");
      var regex = '^\\s*(?:[^' + matchCh + '\\\\]+|\\\\\\\\|\\\\.)' + matchCh;
      if (stream.match(new RegExp(regex), true)) {
        return tokenTypes.linkHref;
      }
    }

    // If this block is changed, it may need to be updated in GFM mode
    if (ch === '`') {
      var previousFormatting = state.formatting;
      if (modeCfg.highlightFormatting) state.formatting = "code";
      var t = getType(state);
      var before = stream.pos;
      stream.eatWhile('`');
      var difference = 1 + stream.pos - before;
      if (!state.code) {
        codeDepth = difference;
        state.code = true;
        return getType(state);
      } else {
        if (difference === codeDepth) { // Must be exact
          state.code = false;
          return t;
        }
        state.formatting = previousFormatting;
        return getType(state);
      }
    } else if (state.code) {
      return getType(state);
    }

    if (ch === '!' && stream.match(/\[[^\]]*\] ?(?:\(|\[)/, false)) {
      stream.match(/\[[^\]]*\]/);
      state.inline = state.f = linkHref;
      return tokenTypes.image;
    }

    if (ch === '[' && stream.match(/.*\](\(.*\)| ?\[.*\])/, false)) {
      state.linkText = true;
      if (modeCfg.highlightFormatting) state.formatting = "link";
      return getType(state);
    }

    if (ch === ']' && state.linkText && stream.match(/\(.*\)| ?\[.*\]/, false)) {
      if (modeCfg.highlightFormatting) state.formatting = "link";
      var type = getType(state);
      state.linkText = false;
      state.inline = state.f = linkHref;
      return type;
    }

    if (ch === '<' && stream.match(/^(https?|ftps?):\/\/(?:[^\\>]|\\.)+>/, false)) {
      state.f = state.inline = linkInline;
      if (modeCfg.highlightFormatting) state.formatting = "link";
      var type = getType(state);
      if (type){
        type += " ";
      } else {
        type = "";
      }
      return type + tokenTypes.linkInline;
    }

    if (ch === '<' && stream.match(/^[^> \\]+@(?:[^\\>]|\\.)+>/, false)) {
      state.f = state.inline = linkInline;
      if (modeCfg.highlightFormatting) state.formatting = "link";
      var type = getType(state);
      if (type){
        type += " ";
      } else {
        type = "";
      }
      return type + tokenTypes.linkEmail;
    }

    if (ch === '<' && stream.match(/^(!--|\w)/, false)) {
      var end = stream.string.indexOf(">", stream.pos);
      if (end != -1) {
        var atts = stream.string.substring(stream.start, end);
        if (/markdown\s*=\s*('|"){0,1}1('|"){0,1}/.test(atts)) state.md_inside = true;
      }
      stream.backUp(1);
      state.htmlState = CodeMirror.startState(htmlMode);
      return switchBlock(stream, state, htmlBlock);
    }

    if (ch === '<' && stream.match(/^\/\w*?>/)) {
      state.md_inside = false;
      return "tag";
    }

    var ignoreUnderscore = false;
    if (!modeCfg.underscoresBreakWords) {
      if (ch === '_' && stream.peek() !== '_' && stream.match(/(\w)/, false)) {
        var prevPos = stream.pos - 2;
        if (prevPos >= 0) {
          var prevCh = stream.string.charAt(prevPos);
          if (prevCh !== '_' && prevCh.match(/(\w)/, false)) {
            ignoreUnderscore = true;
          }
        }
      }
    }
    if (ch === '*' || (ch === '_' && !ignoreUnderscore)) {
      if (sol && stream.peek() === ' ') {
        // Do nothing, surrounded by newline and space
      } else if (state.strong === ch && stream.eat(ch)) { // Remove STRONG
        if (modeCfg.highlightFormatting) state.formatting = "strong";
        var t = getType(state);
        state.strong = false;
        return t;
      } else if (!state.strong && stream.eat(ch)) { // Add STRONG
        state.strong = ch;
        if (modeCfg.highlightFormatting) state.formatting = "strong";
        return getType(state);
      } else if (state.em === ch) { // Remove EM
        if (modeCfg.highlightFormatting) state.formatting = "em";
        var t = getType(state);
        state.em = false;
        return t;
      } else if (!state.em) { // Add EM
        state.em = ch;
        if (modeCfg.highlightFormatting) state.formatting = "em";
        return getType(state);
      }
    } else if (ch === ' ') {
      if (stream.eat('*') || stream.eat('_')) { // Probably surrounded by spaces
        if (stream.peek() === ' ') { // Surrounded by spaces, ignore
          return getType(state);
        } else { // Not surrounded by spaces, back up pointer
          stream.backUp(1);
        }
      }
    }

    if (modeCfg.strikethrough) {
      if (ch === '~' && stream.eatWhile(ch)) {
        if (state.strikethrough) {// Remove strikethrough
          if (modeCfg.highlightFormatting) state.formatting = "strikethrough";
          var t = getType(state);
          state.strikethrough = false;
          return t;
        } else if (stream.match(/^[^\s]/, false)) {// Add strikethrough
          state.strikethrough = true;
          if (modeCfg.highlightFormatting) state.formatting = "strikethrough";
          return getType(state);
        }
      } else if (ch === ' ') {
        if (stream.match(/^~~/, true)) { // Probably surrounded by space
          if (stream.peek() === ' ') { // Surrounded by spaces, ignore
            return getType(state);
          } else { // Not surrounded by spaces, back up pointer
            stream.backUp(2);
          }
        }
      }
    }

    if (ch === ' ') {
      if (stream.match(/ +$/, false)) {
        state.trailingSpace++;
      } else if (state.trailingSpace) {
        state.trailingSpaceNewLine = true;
      }
    }

    return getType(state);
  }

  function linkInline(stream, state) {
    var ch = stream.next();

    if (ch === ">") {
      state.f = state.inline = inlineNormal;
      if (modeCfg.highlightFormatting) state.formatting = "link";
      var type = getType(state);
      if (type){
        type += " ";
      } else {
        type = "";
      }
      return type + tokenTypes.linkInline;
    }

    stream.match(/^[^>]+/, true);

    return tokenTypes.linkInline;
  }

  function linkHref(stream, state) {
    // Check if space, and return NULL if so (to avoid marking the space)
    if(stream.eatSpace()){
      return null;
    }
    var ch = stream.next();
    if (ch === '(' || ch === '[') {
      state.f = state.inline = getLinkHrefInside(ch === "(" ? ")" : "]");
      if (modeCfg.highlightFormatting) state.formatting = "link-string";
      state.linkHref = true;
      return getType(state);
    }
    return 'error';
  }

  function getLinkHrefInside(endChar) {
    return function(stream, state) {
      var ch = stream.next();

      if (ch === endChar) {
        state.f = state.inline = inlineNormal;
        if (modeCfg.highlightFormatting) state.formatting = "link-string";
        var returnState = getType(state);
        state.linkHref = false;
        return returnState;
      }

      if (stream.match(inlineRE(endChar), true)) {
        stream.backUp(1);
      }

      state.linkHref = true;
      return getType(state);
    };
  }

  function footnoteLink(stream, state) {
    if (stream.match(/^[^\]]*\]:/, false)) {
      state.f = footnoteLinkInside;
      stream.next(); // Consume [
      if (modeCfg.highlightFormatting) state.formatting = "link";
      state.linkText = true;
      return getType(state);
    }
    return switchInline(stream, state, inlineNormal);
  }

  function footnoteLinkInside(stream, state) {
    if (stream.match(/^\]:/, true)) {
      state.f = state.inline = footnoteUrl;
      if (modeCfg.highlightFormatting) state.formatting = "link";
      var returnType = getType(state);
      state.linkText = false;
      return returnType;
    }

    stream.match(/^[^\]]+/, true);

    return tokenTypes.linkText;
  }

  function footnoteUrl(stream, state) {
    // Check if space, and return NULL if so (to avoid marking the space)
    if(stream.eatSpace()){
      return null;
    }
    // Match URL
    stream.match(/^[^\s]+/, true);
    // Check for link title
    if (stream.peek() === undefined) { // End of line, set flag to check next line
      state.linkTitle = true;
    } else { // More content on line, check if link title
      stream.match(/^(?:\s+(?:"(?:[^"\\]|\\\\|\\.)+"|'(?:[^'\\]|\\\\|\\.)+'|\((?:[^)\\]|\\\\|\\.)+\)))?/, true);
    }
    state.f = state.inline = inlineNormal;
    return tokenTypes.linkHref + " url";
  }

  var savedInlineRE = [];
  function inlineRE(endChar) {
    if (!savedInlineRE[endChar]) {
      // Escape endChar for RegExp (taken from http://stackoverflow.com/a/494122/526741)
      endChar = (endChar+'').replace(/([.?*+^$[\]\\(){}|-])/g, "\\$1");
      // Match any non-endChar, escaped character, as well as the closing
      // endChar.
      savedInlineRE[endChar] = new RegExp('^(?:[^\\\\]|\\\\.)*?(' + endChar + ')');
    }
    return savedInlineRE[endChar];
  }

  var mode = {
    startState: function() {
      return {
        f: blockNormal,

        prevLine: null,
        thisLine: null,

        block: blockNormal,
        htmlState: null,
        indentation: 0,

        inline: inlineNormal,
        text: handleText,

        formatting: false,
        linkText: false,
        linkHref: false,
        linkTitle: false,
        em: false,
        strong: false,
        header: 0,
        hr: false,
        taskList: false,
        list: false,
        listDepth: 0,
        quote: 0,
        trailingSpace: 0,
        trailingSpaceNewLine: false,
        strikethrough: false,
        fencedChars: null
      };
    },

    copyState: function(s) {
      return {
        f: s.f,

        prevLine: s.prevLine,
        thisLine: s.this,

        block: s.block,
        htmlState: s.htmlState && CodeMirror.copyState(htmlMode, s.htmlState),
        indentation: s.indentation,

        localMode: s.localMode,
        localState: s.localMode ? CodeMirror.copyState(s.localMode, s.localState) : null,

        inline: s.inline,
        text: s.text,
        formatting: false,
        linkTitle: s.linkTitle,
        code: s.code,
        em: s.em,
        strong: s.strong,
        strikethrough: s.strikethrough,
        header: s.header,
        hr: s.hr,
        taskList: s.taskList,
        list: s.list,
        listDepth: s.listDepth,
        quote: s.quote,
        indentedCode: s.indentedCode,
        trailingSpace: s.trailingSpace,
        trailingSpaceNewLine: s.trailingSpaceNewLine,
        md_inside: s.md_inside,
        fencedChars: s.fencedChars
      };
    },

    token: function(stream, state) {

      // Reset state.formatting
      state.formatting = false;

      if (stream != state.thisLine) {
        var forceBlankLine = state.header || state.hr;

        // Reset state.header and state.hr
        state.header = 0;
        state.hr = false;

        if (stream.match(/^\s*$/, true) || forceBlankLine) {
          blankLine(state);
          if (!forceBlankLine) return null
          state.prevLine = null
        }

        state.prevLine = state.thisLine
        state.thisLine = stream

        // Reset state.taskList
        state.taskList = false;

        // Reset state.trailingSpace
        state.trailingSpace = 0;
        state.trailingSpaceNewLine = false;

        state.f = state.block;
        var indentation = stream.match(/^\s*/, true)[0].replace(/\t/g, '    ').length;
        var difference = Math.floor((indentation - state.indentation) / 4) * 4;
        if (difference > 4) difference = 4;
        var adjustedIndentation = state.indentation + difference;
        state.indentationDiff = adjustedIndentation - state.indentation;
        state.indentation = adjustedIndentation;
        if (indentation > 0) return null;
      }
      return state.f(stream, state);
    },

    innerMode: function(state) {
      if (state.block == htmlBlock) return {state: state.htmlState, mode: htmlMode};
      if (state.localState) return {state: state.localState, mode: state.localMode};
      return {state: state, mode: mode};
    },

    blankLine: blankLine,

    getType: getType,

    fold: "markdown"
  };
  return mode;
}, "xml");

CodeMirror.defineMIME("text/x-markdown", "markdown");

});

},{"../../lib/codemirror":2,"../meta":6,"../xml/xml":7}],6:[function(require,module,exports){
// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    mod(require("../lib/codemirror"));
  else if (typeof define == "function" && define.amd) // AMD
    define(["../lib/codemirror"], mod);
  else // Plain browser env
    mod(CodeMirror);
})(function(CodeMirror) {
  "use strict";

  CodeMirror.modeInfo = [
    {name: "APL", mime: "text/apl", mode: "apl", ext: ["dyalog", "apl"]},
    {name: "PGP", mimes: ["application/pgp", "application/pgp-keys", "application/pgp-signature"], mode: "asciiarmor", ext: ["pgp"]},
    {name: "ASN.1", mime: "text/x-ttcn-asn", mode: "asn.1", ext: ["asn", "asn1"]},
    {name: "Asterisk", mime: "text/x-asterisk", mode: "asterisk", file: /^extensions\.conf$/i},
    {name: "Brainfuck", mime: "text/x-brainfuck", mode: "brainfuck", ext: ["b", "bf"]},
    {name: "C", mime: "text/x-csrc", mode: "clike", ext: ["c", "h"]},
    {name: "C++", mime: "text/x-c++src", mode: "clike", ext: ["cpp", "c++", "cc", "cxx", "hpp", "h++", "hh", "hxx"], alias: ["cpp"]},
    {name: "Cobol", mime: "text/x-cobol", mode: "cobol", ext: ["cob", "cpy"]},
    {name: "C#", mime: "text/x-csharp", mode: "clike", ext: ["cs"], alias: ["csharp"]},
    {name: "Clojure", mime: "text/x-clojure", mode: "clojure", ext: ["clj"]},
    {name: "Closure Stylesheets (GSS)", mime: "text/x-gss", mode: "css", ext: ["gss"]},
    {name: "CMake", mime: "text/x-cmake", mode: "cmake", ext: ["cmake", "cmake.in"], file: /^CMakeLists.txt$/},
    {name: "CoffeeScript", mime: "text/x-coffeescript", mode: "coffeescript", ext: ["coffee"], alias: ["coffee", "coffee-script"]},
    {name: "Common Lisp", mime: "text/x-common-lisp", mode: "commonlisp", ext: ["cl", "lisp", "el"], alias: ["lisp"]},
    {name: "Cypher", mime: "application/x-cypher-query", mode: "cypher", ext: ["cyp", "cypher"]},
    {name: "Cython", mime: "text/x-cython", mode: "python", ext: ["pyx", "pxd", "pxi"]},
    {name: "CSS", mime: "text/css", mode: "css", ext: ["css"]},
    {name: "CQL", mime: "text/x-cassandra", mode: "sql", ext: ["cql"]},
    {name: "D", mime: "text/x-d", mode: "d", ext: ["d"]},
    {name: "Dart", mimes: ["application/dart", "text/x-dart"], mode: "dart", ext: ["dart"]},
    {name: "diff", mime: "text/x-diff", mode: "diff", ext: ["diff", "patch"]},
    {name: "Django", mime: "text/x-django", mode: "django"},
    {name: "Dockerfile", mime: "text/x-dockerfile", mode: "dockerfile", file: /^Dockerfile$/},
    {name: "DTD", mime: "application/xml-dtd", mode: "dtd", ext: ["dtd"]},
    {name: "Dylan", mime: "text/x-dylan", mode: "dylan", ext: ["dylan", "dyl", "intr"]},
    {name: "EBNF", mime: "text/x-ebnf", mode: "ebnf"},
    {name: "ECL", mime: "text/x-ecl", mode: "ecl", ext: ["ecl"]},
    {name: "Eiffel", mime: "text/x-eiffel", mode: "eiffel", ext: ["e"]},
    {name: "Elm", mime: "text/x-elm", mode: "elm", ext: ["elm"]},
    {name: "Embedded Javascript", mime: "application/x-ejs", mode: "htmlembedded", ext: ["ejs"]},
    {name: "Embedded Ruby", mime: "application/x-erb", mode: "htmlembedded", ext: ["erb"]},
    {name: "Erlang", mime: "text/x-erlang", mode: "erlang", ext: ["erl"]},
    {name: "Factor", mime: "text/x-factor", mode: "factor", ext: ["factor"]},
    {name: "Forth", mime: "text/x-forth", mode: "forth", ext: ["forth", "fth", "4th"]},
    {name: "Fortran", mime: "text/x-fortran", mode: "fortran", ext: ["f", "for", "f77", "f90"]},
    {name: "F#", mime: "text/x-fsharp", mode: "mllike", ext: ["fs"], alias: ["fsharp"]},
    {name: "Gas", mime: "text/x-gas", mode: "gas", ext: ["s"]},
    {name: "Gherkin", mime: "text/x-feature", mode: "gherkin", ext: ["feature"]},
    {name: "GitHub Flavored Markdown", mime: "text/x-gfm", mode: "gfm", file: /^(readme|contributing|history).md$/i},
    {name: "Go", mime: "text/x-go", mode: "go", ext: ["go"]},
    {name: "Groovy", mime: "text/x-groovy", mode: "groovy", ext: ["groovy"]},
    {name: "HAML", mime: "text/x-haml", mode: "haml", ext: ["haml"]},
    {name: "Haskell", mime: "text/x-haskell", mode: "haskell", ext: ["hs"]},
    {name: "Haxe", mime: "text/x-haxe", mode: "haxe", ext: ["hx"]},
    {name: "HXML", mime: "text/x-hxml", mode: "haxe", ext: ["hxml"]},
    {name: "ASP.NET", mime: "application/x-aspx", mode: "htmlembedded", ext: ["aspx"], alias: ["asp", "aspx"]},
    {name: "HTML", mime: "text/html", mode: "htmlmixed", ext: ["html", "htm"], alias: ["xhtml"]},
    {name: "HTTP", mime: "message/http", mode: "http"},
    {name: "IDL", mime: "text/x-idl", mode: "idl", ext: ["pro"]},
    {name: "Jade", mime: "text/x-jade", mode: "jade", ext: ["jade"]},
    {name: "Java", mime: "text/x-java", mode: "clike", ext: ["java"]},
    {name: "Java Server Pages", mime: "application/x-jsp", mode: "htmlembedded", ext: ["jsp"], alias: ["jsp"]},
    {name: "JavaScript", mimes: ["text/javascript", "text/ecmascript", "application/javascript", "application/x-javascript", "application/ecmascript"],
     mode: "javascript", ext: ["js"], alias: ["ecmascript", "js", "node"]},
    {name: "JSON", mimes: ["application/json", "application/x-json"], mode: "javascript", ext: ["json", "map"], alias: ["json5"]},
    {name: "JSON-LD", mime: "application/ld+json", mode: "javascript", ext: ["jsonld"], alias: ["jsonld"]},
    {name: "Jinja2", mime: "null", mode: "jinja2"},
    {name: "Julia", mime: "text/x-julia", mode: "julia", ext: ["jl"]},
    {name: "Kotlin", mime: "text/x-kotlin", mode: "clike", ext: ["kt"]},
    {name: "LESS", mime: "text/x-less", mode: "css", ext: ["less"]},
    {name: "LiveScript", mime: "text/x-livescript", mode: "livescript", ext: ["ls"], alias: ["ls"]},
    {name: "Lua", mime: "text/x-lua", mode: "lua", ext: ["lua"]},
    {name: "Markdown", mime: "text/x-markdown", mode: "markdown", ext: ["markdown", "md", "mkd"]},
    {name: "mIRC", mime: "text/mirc", mode: "mirc"},
    {name: "MariaDB SQL", mime: "text/x-mariadb", mode: "sql"},
    {name: "Mathematica", mime: "text/x-mathematica", mode: "mathematica", ext: ["m", "nb"]},
    {name: "Modelica", mime: "text/x-modelica", mode: "modelica", ext: ["mo"]},
    {name: "MUMPS", mime: "text/x-mumps", mode: "mumps"},
    {name: "MS SQL", mime: "text/x-mssql", mode: "sql"},
    {name: "MySQL", mime: "text/x-mysql", mode: "sql"},
    {name: "Nginx", mime: "text/x-nginx-conf", mode: "nginx", file: /nginx.*\.conf$/i},
    {name: "NSIS", mime: "text/x-nsis", mode: "nsis", ext: ["nsh", "nsi"]},
    {name: "NTriples", mime: "text/n-triples", mode: "ntriples", ext: ["nt"]},
    {name: "Objective C", mime: "text/x-objectivec", mode: "clike", ext: ["m", "mm"]},
    {name: "OCaml", mime: "text/x-ocaml", mode: "mllike", ext: ["ml", "mli", "mll", "mly"]},
    {name: "Octave", mime: "text/x-octave", mode: "octave", ext: ["m"]},
    {name: "Oz", mime: "text/x-oz", mode: "oz", ext: ["oz"]},
    {name: "Pascal", mime: "text/x-pascal", mode: "pascal", ext: ["p", "pas"]},
    {name: "PEG.js", mime: "null", mode: "pegjs", ext: ["jsonld"]},
    {name: "Perl", mime: "text/x-perl", mode: "perl", ext: ["pl", "pm"]},
    {name: "PHP", mime: "application/x-httpd-php", mode: "php", ext: ["php", "php3", "php4", "php5", "phtml"]},
    {name: "Pig", mime: "text/x-pig", mode: "pig", ext: ["pig"]},
    {name: "Plain Text", mime: "text/plain", mode: "null", ext: ["txt", "text", "conf", "def", "list", "log"]},
    {name: "PLSQL", mime: "text/x-plsql", mode: "sql", ext: ["pls"]},
    {name: "Properties files", mime: "text/x-properties", mode: "properties", ext: ["properties", "ini", "in"], alias: ["ini", "properties"]},
    {name: "Python", mime: "text/x-python", mode: "python", ext: ["py", "pyw"]},
    {name: "Puppet", mime: "text/x-puppet", mode: "puppet", ext: ["pp"]},
    {name: "Q", mime: "text/x-q", mode: "q", ext: ["q"]},
    {name: "R", mime: "text/x-rsrc", mode: "r", ext: ["r"], alias: ["rscript"]},
    {name: "reStructuredText", mime: "text/x-rst", mode: "rst", ext: ["rst"], alias: ["rst"]},
    {name: "RPM Changes", mime: "text/x-rpm-changes", mode: "rpm"},
    {name: "RPM Spec", mime: "text/x-rpm-spec", mode: "rpm", ext: ["spec"]},
    {name: "Ruby", mime: "text/x-ruby", mode: "ruby", ext: ["rb"], alias: ["jruby", "macruby", "rake", "rb", "rbx"]},
    {name: "Rust", mime: "text/x-rustsrc", mode: "rust", ext: ["rs"]},
    {name: "Sass", mime: "text/x-sass", mode: "sass", ext: ["sass"]},
    {name: "Scala", mime: "text/x-scala", mode: "clike", ext: ["scala"]},
    {name: "Scheme", mime: "text/x-scheme", mode: "scheme", ext: ["scm", "ss"]},
    {name: "SCSS", mime: "text/x-scss", mode: "css", ext: ["scss"]},
    {name: "Shell", mime: "text/x-sh", mode: "shell", ext: ["sh", "ksh", "bash"], alias: ["bash", "sh", "zsh"], file: /^PKGBUILD$/},
    {name: "Sieve", mime: "application/sieve", mode: "sieve", ext: ["siv", "sieve"]},
    {name: "Slim", mimes: ["text/x-slim", "application/x-slim"], mode: "slim", ext: ["slim"]},
    {name: "Smalltalk", mime: "text/x-stsrc", mode: "smalltalk", ext: ["st"]},
    {name: "Smarty", mime: "text/x-smarty", mode: "smarty", ext: ["tpl"]},
    {name: "Solr", mime: "text/x-solr", mode: "solr"},
    {name: "Soy", mime: "text/x-soy", mode: "soy", ext: ["soy"], alias: ["closure template"]},
    {name: "SPARQL", mime: "application/sparql-query", mode: "sparql", ext: ["rq", "sparql"], alias: ["sparul"]},
    {name: "Spreadsheet", mime: "text/x-spreadsheet", mode: "spreadsheet", alias: ["excel", "formula"]},
    {name: "SQL", mime: "text/x-sql", mode: "sql", ext: ["sql"]},
    {name: "Squirrel", mime: "text/x-squirrel", mode: "clike", ext: ["nut"]},
    {name: "Swift", mime: "text/x-swift", mode: "swift", ext: ["swift"]},
    {name: "MariaDB", mime: "text/x-mariadb", mode: "sql"},
    {name: "sTeX", mime: "text/x-stex", mode: "stex"},
    {name: "LaTeX", mime: "text/x-latex", mode: "stex", ext: ["text", "ltx"], alias: ["tex"]},
    {name: "SystemVerilog", mime: "text/x-systemverilog", mode: "verilog", ext: ["v"]},
    {name: "Tcl", mime: "text/x-tcl", mode: "tcl", ext: ["tcl"]},
    {name: "Textile", mime: "text/x-textile", mode: "textile", ext: ["textile"]},
    {name: "TiddlyWiki ", mime: "text/x-tiddlywiki", mode: "tiddlywiki"},
    {name: "Tiki wiki", mime: "text/tiki", mode: "tiki"},
    {name: "TOML", mime: "text/x-toml", mode: "toml", ext: ["toml"]},
    {name: "Tornado", mime: "text/x-tornado", mode: "tornado"},
    {name: "troff", mime: "troff", mode: "troff", ext: ["1", "2", "3", "4", "5", "6", "7", "8", "9"]},
    {name: "TTCN", mime: "text/x-ttcn", mode: "ttcn", ext: ["ttcn", "ttcn3", "ttcnpp"]},
    {name: "TTCN_CFG", mime: "text/x-ttcn-cfg", mode: "ttcn-cfg", ext: ["cfg"]},
    {name: "Turtle", mime: "text/turtle", mode: "turtle", ext: ["ttl"]},
    {name: "TypeScript", mime: "application/typescript", mode: "javascript", ext: ["ts"], alias: ["ts"]},
    {name: "Twig", mime: "text/x-twig", mode: "twig"},
    {name: "VB.NET", mime: "text/x-vb", mode: "vb", ext: ["vb"]},
    {name: "VBScript", mime: "text/vbscript", mode: "vbscript", ext: ["vbs"]},
    {name: "Velocity", mime: "text/velocity", mode: "velocity", ext: ["vtl"]},
    {name: "Verilog", mime: "text/x-verilog", mode: "verilog", ext: ["v"]},
    {name: "VHDL", mime: "text/x-vhdl", mode: "vhdl", ext: ["vhd", "vhdl"]},
    {name: "XML", mimes: ["application/xml", "text/xml"], mode: "xml", ext: ["xml", "xsl", "xsd"], alias: ["rss", "wsdl", "xsd"]},
    {name: "XQuery", mime: "application/xquery", mode: "xquery", ext: ["xy", "xquery"]},
    {name: "YAML", mime: "text/x-yaml", mode: "yaml", ext: ["yaml", "yml"], alias: ["yml"]},
    {name: "Z80", mime: "text/x-z80", mode: "z80", ext: ["z80"]},
    {name: "mscgen", mime: "text/x-mscgen", mode: "mscgen", ext: ["mscgen", "mscin", "msc"]},
    {name: "xu", mime: "text/x-xu", mode: "mscgen", ext: ["xu"]},
    {name: "msgenny", mime: "text/x-msgenny", mode: "mscgen", ext: ["msgenny"]}
  ];
  // Ensure all modes have a mime property for backwards compatibility
  for (var i = 0; i < CodeMirror.modeInfo.length; i++) {
    var info = CodeMirror.modeInfo[i];
    if (info.mimes) info.mime = info.mimes[0];
  }

  CodeMirror.findModeByMIME = function(mime) {
    mime = mime.toLowerCase();
    for (var i = 0; i < CodeMirror.modeInfo.length; i++) {
      var info = CodeMirror.modeInfo[i];
      if (info.mime == mime) return info;
      if (info.mimes) for (var j = 0; j < info.mimes.length; j++)
        if (info.mimes[j] == mime) return info;
    }
  };

  CodeMirror.findModeByExtension = function(ext) {
    for (var i = 0; i < CodeMirror.modeInfo.length; i++) {
      var info = CodeMirror.modeInfo[i];
      if (info.ext) for (var j = 0; j < info.ext.length; j++)
        if (info.ext[j] == ext) return info;
    }
  };

  CodeMirror.findModeByFileName = function(filename) {
    for (var i = 0; i < CodeMirror.modeInfo.length; i++) {
      var info = CodeMirror.modeInfo[i];
      if (info.file && info.file.test(filename)) return info;
    }
    var dot = filename.lastIndexOf(".");
    var ext = dot > -1 && filename.substring(dot + 1, filename.length);
    if (ext) return CodeMirror.findModeByExtension(ext);
  };

  CodeMirror.findModeByName = function(name) {
    name = name.toLowerCase();
    for (var i = 0; i < CodeMirror.modeInfo.length; i++) {
      var info = CodeMirror.modeInfo[i];
      if (info.name.toLowerCase() == name) return info;
      if (info.alias) for (var j = 0; j < info.alias.length; j++)
        if (info.alias[j].toLowerCase() == name) return info;
    }
  };
});

},{"../lib/codemirror":2}],7:[function(require,module,exports){
// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    mod(require("../../lib/codemirror"));
  else if (typeof define == "function" && define.amd) // AMD
    define(["../../lib/codemirror"], mod);
  else // Plain browser env
    mod(CodeMirror);
})(function(CodeMirror) {
"use strict";

CodeMirror.defineMode("xml", function(config, parserConfig) {
  var indentUnit = config.indentUnit;
  var multilineTagIndentFactor = parserConfig.multilineTagIndentFactor || 1;
  var multilineTagIndentPastTag = parserConfig.multilineTagIndentPastTag;
  if (multilineTagIndentPastTag == null) multilineTagIndentPastTag = true;

  var Kludges = parserConfig.htmlMode ? {
    autoSelfClosers: {'area': true, 'base': true, 'br': true, 'col': true, 'command': true,
                      'embed': true, 'frame': true, 'hr': true, 'img': true, 'input': true,
                      'keygen': true, 'link': true, 'meta': true, 'param': true, 'source': true,
                      'track': true, 'wbr': true, 'menuitem': true},
    implicitlyClosed: {'dd': true, 'li': true, 'optgroup': true, 'option': true, 'p': true,
                       'rp': true, 'rt': true, 'tbody': true, 'td': true, 'tfoot': true,
                       'th': true, 'tr': true},
    contextGrabbers: {
      'dd': {'dd': true, 'dt': true},
      'dt': {'dd': true, 'dt': true},
      'li': {'li': true},
      'option': {'option': true, 'optgroup': true},
      'optgroup': {'optgroup': true},
      'p': {'address': true, 'article': true, 'aside': true, 'blockquote': true, 'dir': true,
            'div': true, 'dl': true, 'fieldset': true, 'footer': true, 'form': true,
            'h1': true, 'h2': true, 'h3': true, 'h4': true, 'h5': true, 'h6': true,
            'header': true, 'hgroup': true, 'hr': true, 'menu': true, 'nav': true, 'ol': true,
            'p': true, 'pre': true, 'section': true, 'table': true, 'ul': true},
      'rp': {'rp': true, 'rt': true},
      'rt': {'rp': true, 'rt': true},
      'tbody': {'tbody': true, 'tfoot': true},
      'td': {'td': true, 'th': true},
      'tfoot': {'tbody': true},
      'th': {'td': true, 'th': true},
      'thead': {'tbody': true, 'tfoot': true},
      'tr': {'tr': true}
    },
    doNotIndent: {"pre": true},
    allowUnquoted: true,
    allowMissing: true,
    caseFold: true
  } : {
    autoSelfClosers: {},
    implicitlyClosed: {},
    contextGrabbers: {},
    doNotIndent: {},
    allowUnquoted: false,
    allowMissing: false,
    caseFold: false
  };
  var alignCDATA = parserConfig.alignCDATA;

  // Return variables for tokenizers
  var type, setStyle;

  function inText(stream, state) {
    function chain(parser) {
      state.tokenize = parser;
      return parser(stream, state);
    }

    var ch = stream.next();
    if (ch == "<") {
      if (stream.eat("!")) {
        if (stream.eat("[")) {
          if (stream.match("CDATA[")) return chain(inBlock("atom", "]]>"));
          else return null;
        } else if (stream.match("--")) {
          return chain(inBlock("comment", "-->"));
        } else if (stream.match("DOCTYPE", true, true)) {
          stream.eatWhile(/[\w\._\-]/);
          return chain(doctype(1));
        } else {
          return null;
        }
      } else if (stream.eat("?")) {
        stream.eatWhile(/[\w\._\-]/);
        state.tokenize = inBlock("meta", "?>");
        return "meta";
      } else {
        type = stream.eat("/") ? "closeTag" : "openTag";
        state.tokenize = inTag;
        return "tag bracket";
      }
    } else if (ch == "&") {
      var ok;
      if (stream.eat("#")) {
        if (stream.eat("x")) {
          ok = stream.eatWhile(/[a-fA-F\d]/) && stream.eat(";");
        } else {
          ok = stream.eatWhile(/[\d]/) && stream.eat(";");
        }
      } else {
        ok = stream.eatWhile(/[\w\.\-:]/) && stream.eat(";");
      }
      return ok ? "atom" : "error";
    } else {
      stream.eatWhile(/[^&<]/);
      return null;
    }
  }
  inText.isInText = true;

  function inTag(stream, state) {
    var ch = stream.next();
    if (ch == ">" || (ch == "/" && stream.eat(">"))) {
      state.tokenize = inText;
      type = ch == ">" ? "endTag" : "selfcloseTag";
      return "tag bracket";
    } else if (ch == "=") {
      type = "equals";
      return null;
    } else if (ch == "<") {
      state.tokenize = inText;
      state.state = baseState;
      state.tagName = state.tagStart = null;
      var next = state.tokenize(stream, state);
      return next ? next + " tag error" : "tag error";
    } else if (/[\'\"]/.test(ch)) {
      state.tokenize = inAttribute(ch);
      state.stringStartCol = stream.column();
      return state.tokenize(stream, state);
    } else {
      stream.match(/^[^\s\u00a0=<>\"\']*[^\s\u00a0=<>\"\'\/]/);
      return "word";
    }
  }

  function inAttribute(quote) {
    var closure = function(stream, state) {
      while (!stream.eol()) {
        if (stream.next() == quote) {
          state.tokenize = inTag;
          break;
        }
      }
      return "string";
    };
    closure.isInAttribute = true;
    return closure;
  }

  function inBlock(style, terminator) {
    return function(stream, state) {
      while (!stream.eol()) {
        if (stream.match(terminator)) {
          state.tokenize = inText;
          break;
        }
        stream.next();
      }
      return style;
    };
  }
  function doctype(depth) {
    return function(stream, state) {
      var ch;
      while ((ch = stream.next()) != null) {
        if (ch == "<") {
          state.tokenize = doctype(depth + 1);
          return state.tokenize(stream, state);
        } else if (ch == ">") {
          if (depth == 1) {
            state.tokenize = inText;
            break;
          } else {
            state.tokenize = doctype(depth - 1);
            return state.tokenize(stream, state);
          }
        }
      }
      return "meta";
    };
  }

  function Context(state, tagName, startOfLine) {
    this.prev = state.context;
    this.tagName = tagName;
    this.indent = state.indented;
    this.startOfLine = startOfLine;
    if (Kludges.doNotIndent.hasOwnProperty(tagName) || (state.context && state.context.noIndent))
      this.noIndent = true;
  }
  function popContext(state) {
    if (state.context) state.context = state.context.prev;
  }
  function maybePopContext(state, nextTagName) {
    var parentTagName;
    while (true) {
      if (!state.context) {
        return;
      }
      parentTagName = state.context.tagName;
      if (!Kludges.contextGrabbers.hasOwnProperty(parentTagName) ||
          !Kludges.contextGrabbers[parentTagName].hasOwnProperty(nextTagName)) {
        return;
      }
      popContext(state);
    }
  }

  function baseState(type, stream, state) {
    if (type == "openTag") {
      state.tagStart = stream.column();
      return tagNameState;
    } else if (type == "closeTag") {
      return closeTagNameState;
    } else {
      return baseState;
    }
  }
  function tagNameState(type, stream, state) {
    if (type == "word") {
      state.tagName = stream.current();
      setStyle = "tag";
      return attrState;
    } else {
      setStyle = "error";
      return tagNameState;
    }
  }
  function closeTagNameState(type, stream, state) {
    if (type == "word") {
      var tagName = stream.current();
      if (state.context && state.context.tagName != tagName &&
          Kludges.implicitlyClosed.hasOwnProperty(state.context.tagName))
        popContext(state);
      if (state.context && state.context.tagName == tagName) {
        setStyle = "tag";
        return closeState;
      } else {
        setStyle = "tag error";
        return closeStateErr;
      }
    } else {
      setStyle = "error";
      return closeStateErr;
    }
  }

  function closeState(type, _stream, state) {
    if (type != "endTag") {
      setStyle = "error";
      return closeState;
    }
    popContext(state);
    return baseState;
  }
  function closeStateErr(type, stream, state) {
    setStyle = "error";
    return closeState(type, stream, state);
  }

  function attrState(type, _stream, state) {
    if (type == "word") {
      setStyle = "attribute";
      return attrEqState;
    } else if (type == "endTag" || type == "selfcloseTag") {
      var tagName = state.tagName, tagStart = state.tagStart;
      state.tagName = state.tagStart = null;
      if (type == "selfcloseTag" ||
          Kludges.autoSelfClosers.hasOwnProperty(tagName)) {
        maybePopContext(state, tagName);
      } else {
        maybePopContext(state, tagName);
        state.context = new Context(state, tagName, tagStart == state.indented);
      }
      return baseState;
    }
    setStyle = "error";
    return attrState;
  }
  function attrEqState(type, stream, state) {
    if (type == "equals") return attrValueState;
    if (!Kludges.allowMissing) setStyle = "error";
    return attrState(type, stream, state);
  }
  function attrValueState(type, stream, state) {
    if (type == "string") return attrContinuedState;
    if (type == "word" && Kludges.allowUnquoted) {setStyle = "string"; return attrState;}
    setStyle = "error";
    return attrState(type, stream, state);
  }
  function attrContinuedState(type, stream, state) {
    if (type == "string") return attrContinuedState;
    return attrState(type, stream, state);
  }

  return {
    startState: function() {
      return {tokenize: inText,
              state: baseState,
              indented: 0,
              tagName: null, tagStart: null,
              context: null};
    },

    token: function(stream, state) {
      if (!state.tagName && stream.sol())
        state.indented = stream.indentation();

      if (stream.eatSpace()) return null;
      type = null;
      var style = state.tokenize(stream, state);
      if ((style || type) && style != "comment") {
        setStyle = null;
        state.state = state.state(type || style, stream, state);
        if (setStyle)
          style = setStyle == "error" ? style + " error" : setStyle;
      }
      return style;
    },

    indent: function(state, textAfter, fullLine) {
      var context = state.context;
      // Indent multi-line strings (e.g. css).
      if (state.tokenize.isInAttribute) {
        if (state.tagStart == state.indented)
          return state.stringStartCol + 1;
        else
          return state.indented + indentUnit;
      }
      if (context && context.noIndent) return CodeMirror.Pass;
      if (state.tokenize != inTag && state.tokenize != inText)
        return fullLine ? fullLine.match(/^(\s*)/)[0].length : 0;
      // Indent the starts of attribute names.
      if (state.tagName) {
        if (multilineTagIndentPastTag)
          return state.tagStart + state.tagName.length + 2;
        else
          return state.tagStart + indentUnit * multilineTagIndentFactor;
      }
      if (alignCDATA && /<!\[CDATA\[/.test(textAfter)) return 0;
      var tagAfter = textAfter && /^<(\/)?([\w_:\.-]*)/.exec(textAfter);
      if (tagAfter && tagAfter[1]) { // Closing tag spotted
        while (context) {
          if (context.tagName == tagAfter[2]) {
            context = context.prev;
            break;
          } else if (Kludges.implicitlyClosed.hasOwnProperty(context.tagName)) {
            context = context.prev;
          } else {
            break;
          }
        }
      } else if (tagAfter) { // Opening tag spotted
        while (context) {
          var grabbers = Kludges.contextGrabbers[context.tagName];
          if (grabbers && grabbers.hasOwnProperty(tagAfter[2]))
            context = context.prev;
          else
            break;
        }
      }
      while (context && !context.startOfLine)
        context = context.prev;
      if (context) return context.indent + indentUnit;
      else return 0;
    },

    electricInput: /<\/[\s\w:]+>$/,
    blockCommentStart: "<!--",
    blockCommentEnd: "-->",

    configuration: parserConfig.htmlMode ? "html" : "xml",
    helperType: parserConfig.htmlMode ? "html" : "xml"
  };
});

CodeMirror.defineMIME("text/xml", "xml");
CodeMirror.defineMIME("application/xml", "xml");
if (!CodeMirror.mimeModes.hasOwnProperty("text/html"))
  CodeMirror.defineMIME("text/html", {name: "xml", htmlMode: true});

});

},{"../../lib/codemirror":2}],8:[function(require,module,exports){
var app_1 = require("./app");
(function (NodeTypes) {
    NodeTypes[NodeTypes["ENTITY"] = 0] = "ENTITY";
    NodeTypes[NodeTypes["COLLECTION"] = 1] = "COLLECTION";
    NodeTypes[NodeTypes["ATTRIBUTE"] = 2] = "ATTRIBUTE";
    NodeTypes[NodeTypes["NUMBER"] = 3] = "NUMBER";
    NodeTypes[NodeTypes["STRING"] = 4] = "STRING";
    NodeTypes[NodeTypes["FUNCTION"] = 5] = "FUNCTION";
})(exports.NodeTypes || (exports.NodeTypes = {}));
var NodeTypes = exports.NodeTypes;
(function (Intents) {
    Intents[Intents["QUERY"] = 0] = "QUERY";
    Intents[Intents["INSERT"] = 1] = "INSERT";
    Intents[Intents["MOREINFO"] = 2] = "MOREINFO";
    Intents[Intents["NORESULT"] = 3] = "NORESULT";
})(exports.Intents || (exports.Intents = {}));
var Intents = exports.Intents;
// Entry point for NLQP
function parse(queryString, lastParse) {
    var tree;
    var context;
    var tokens;
    // If this is the first run, then create a root node.
    if (lastParse === undefined) {
        var rootToken = newToken("root");
        rootToken.properties.push(Properties.ROOT);
        tree = newNode(rootToken);
        tree.found = true;
        context = newContext();
        tokens = [rootToken];
    }
    else {
        tree = lastParse.tree;
        context = lastParse.context;
        tokens = lastParse.tokens;
    }
    // Now do something with the query string
    var words = normalizeQueryString(queryString);
    for (var _i = 0; _i < words.length; _i++) {
        var word = words[_i];
        // From a token
        var token = formToken(word);
        // Link new token with the rest
        var lastToken = tokens[tokens.length - 1];
        lastToken.next = token;
        token.prev = lastToken;
        tokens.push(token);
        // Add the token to the tree
        var node = newNode(token);
        var treeResult = formTree(node, tree, context);
        tree = treeResult.tree;
        context = treeResult.context;
    }
    // Manage context
    context.entities = context.found.filter(function (n) { return n.hasProperty(Properties.ENTITY); });
    context.collections = context.found.filter(function (n) { return n.hasProperty(Properties.COLLECTION); });
    context.attributes = context.found.filter(function (n) { return n.hasProperty(Properties.ATTRIBUTE); });
    // Manage results
    var intent = Intents.NORESULT;
    var query = newQuery();
    var insertResults = [];
    if (allFound(tree)) {
        var inserts = context.fxns.filter(function (f) { return f.fxn.type === FunctionTypes.INSERT; });
        if (inserts.length > 0) {
            intent = Intents.INSERT;
            // Format each insert
            for (var _a = 0; _a < inserts.length; _a++) {
                var insert = inserts[_a];
                if (insert.children.every(function (c) { return c.found; })) {
                    // Collapse the result root if every node doesn't have a child
                    if (insert.children[2].children.length > 1 && insert.children[2].children.every(function (c) { return c.children.length === 0; })) {
                        var nName = insert.children[2].children.map(function (c) { return c.name; }).join(" ");
                        var nToken = newToken(nName);
                        var nNode = newNode(nToken);
                        nNode.found = true;
                        nNode.type = NodeTypes.STRING;
                        insert.children[2].children.map(removeNode);
                        insert.children[2].addChild(nNode);
                    }
                    var insertResult = {
                        entity: insert.children[0].children[0],
                        attribute: insert.children[1].children[0],
                        value: insert.children[2].children[0],
                    };
                    insertResults.push(insertResult);
                }
            }
        }
        else if (context.maybeAttributes.length > 0) {
            intent = Intents.MOREINFO;
        }
        else {
            // Create the query from the new tree
            intent = Intents.QUERY;
            log("Building query...");
            query = formQuery(tree);
            if (query.projects.length === 0) {
                intent = Intents.NORESULT;
            }
        }
    }
    return [{ intent: intent, context: context, tokens: tokens, tree: tree, query: query, inserts: insertResults }];
}
exports.parse = parse;
// Returns false if any nodes are not marked found
// Returns true if all nodes are marked found
function treeComplete(node) {
    if (node.found === false) {
        return false;
    }
    else {
        var childrenStatus = node.children.map(treeComplete);
        return childrenStatus.every(function (child) { return child === true; });
    }
}
// Performs some transformations to the query string before tokenizing
function normalizeQueryString(queryString) {
    // Add whitespace before and after separator and operators
    var normalizedQueryString = queryString.replace(/,/g, ' , ');
    normalizedQueryString = normalizedQueryString.replace(/;/g, ' ; ');
    normalizedQueryString = normalizedQueryString.replace(/\+/g, ' + ');
    normalizedQueryString = normalizedQueryString.replace(/\+/g, ' ^ ');
    normalizedQueryString = normalizedQueryString.replace(/-/g, ' - ');
    normalizedQueryString = normalizedQueryString.replace(/\*/g, ' * ');
    normalizedQueryString = normalizedQueryString.replace(/\//g, ' / ');
    normalizedQueryString = normalizedQueryString.replace(/"/g, ' " ');
    // Split possessive endings
    normalizedQueryString = normalizedQueryString.replace(/\'s/g, ' \'s ');
    normalizedQueryString = normalizedQueryString.replace(/s'/g, 's \' ');
    // Clean various symbols we don't want to deal with
    normalizedQueryString = normalizedQueryString.replace(/`|\?|\:|\[|\]|\{|\}|\(|\)|\~|\`|~|@|#|\$|%|&|_|\|/g, ' ');
    // Collapse whitespace   
    normalizedQueryString = normalizedQueryString.replace(/\s+/g, ' ');
    // Split words at whitespace
    var splitStrings = normalizedQueryString.split(" ");
    var words = splitStrings.map(function (text, i) { return { ix: i + 1, text: text }; });
    words = words.filter(function (word) { return word.text !== ""; });
    return words;
}
exports.normalizeQueryString = normalizeQueryString;
// ----------------------------------------------------------------------------
// Token functions
// ----------------------------------------------------------------------------
var MajorPartsOfSpeech;
(function (MajorPartsOfSpeech) {
    MajorPartsOfSpeech[MajorPartsOfSpeech["ROOT"] = 0] = "ROOT";
    MajorPartsOfSpeech[MajorPartsOfSpeech["VERB"] = 1] = "VERB";
    MajorPartsOfSpeech[MajorPartsOfSpeech["ADJECTIVE"] = 2] = "ADJECTIVE";
    MajorPartsOfSpeech[MajorPartsOfSpeech["ADVERB"] = 3] = "ADVERB";
    MajorPartsOfSpeech[MajorPartsOfSpeech["NOUN"] = 4] = "NOUN";
    MajorPartsOfSpeech[MajorPartsOfSpeech["VALUE"] = 5] = "VALUE";
    MajorPartsOfSpeech[MajorPartsOfSpeech["GLUE"] = 6] = "GLUE";
    MajorPartsOfSpeech[MajorPartsOfSpeech["WHWORD"] = 7] = "WHWORD";
    MajorPartsOfSpeech[MajorPartsOfSpeech["SYMBOL"] = 8] = "SYMBOL";
})(MajorPartsOfSpeech || (MajorPartsOfSpeech = {}));
var MinorPartsOfSpeech;
(function (MinorPartsOfSpeech) {
    MinorPartsOfSpeech[MinorPartsOfSpeech["ROOT"] = 0] = "ROOT";
    // Verb
    MinorPartsOfSpeech[MinorPartsOfSpeech["VB"] = 1] = "VB";
    MinorPartsOfSpeech[MinorPartsOfSpeech["VBD"] = 2] = "VBD";
    MinorPartsOfSpeech[MinorPartsOfSpeech["VBN"] = 3] = "VBN";
    MinorPartsOfSpeech[MinorPartsOfSpeech["VBP"] = 4] = "VBP";
    MinorPartsOfSpeech[MinorPartsOfSpeech["VBZ"] = 5] = "VBZ";
    MinorPartsOfSpeech[MinorPartsOfSpeech["VBF"] = 6] = "VBF";
    MinorPartsOfSpeech[MinorPartsOfSpeech["CP"] = 7] = "CP";
    MinorPartsOfSpeech[MinorPartsOfSpeech["VBG"] = 8] = "VBG";
    // Adjective
    MinorPartsOfSpeech[MinorPartsOfSpeech["JJ"] = 9] = "JJ";
    MinorPartsOfSpeech[MinorPartsOfSpeech["JJR"] = 10] = "JJR";
    MinorPartsOfSpeech[MinorPartsOfSpeech["JJS"] = 11] = "JJS";
    // Adverb
    MinorPartsOfSpeech[MinorPartsOfSpeech["RB"] = 12] = "RB";
    MinorPartsOfSpeech[MinorPartsOfSpeech["RBR"] = 13] = "RBR";
    MinorPartsOfSpeech[MinorPartsOfSpeech["RBS"] = 14] = "RBS";
    // Noun
    MinorPartsOfSpeech[MinorPartsOfSpeech["NN"] = 15] = "NN";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NNPA"] = 16] = "NNPA";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NNAB"] = 17] = "NNAB";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NG"] = 18] = "NG";
    MinorPartsOfSpeech[MinorPartsOfSpeech["PRP"] = 19] = "PRP";
    MinorPartsOfSpeech[MinorPartsOfSpeech["PP"] = 20] = "PP";
    // Legacy Noun
    MinorPartsOfSpeech[MinorPartsOfSpeech["NNP"] = 21] = "NNP";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NNPS"] = 22] = "NNPS";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NNO"] = 23] = "NNO";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NNS"] = 24] = "NNS";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NNA"] = 25] = "NNA";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NNQ"] = 26] = "NNQ";
    // Glue
    MinorPartsOfSpeech[MinorPartsOfSpeech["FW"] = 27] = "FW";
    MinorPartsOfSpeech[MinorPartsOfSpeech["IN"] = 28] = "IN";
    MinorPartsOfSpeech[MinorPartsOfSpeech["MD"] = 29] = "MD";
    MinorPartsOfSpeech[MinorPartsOfSpeech["CC"] = 30] = "CC";
    MinorPartsOfSpeech[MinorPartsOfSpeech["PDT"] = 31] = "PDT";
    MinorPartsOfSpeech[MinorPartsOfSpeech["DT"] = 32] = "DT";
    MinorPartsOfSpeech[MinorPartsOfSpeech["UH"] = 33] = "UH";
    MinorPartsOfSpeech[MinorPartsOfSpeech["EX"] = 34] = "EX";
    // Value
    MinorPartsOfSpeech[MinorPartsOfSpeech["CD"] = 35] = "CD";
    MinorPartsOfSpeech[MinorPartsOfSpeech["DA"] = 36] = "DA";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NU"] = 37] = "NU";
    // Symbol
    MinorPartsOfSpeech[MinorPartsOfSpeech["LT"] = 38] = "LT";
    MinorPartsOfSpeech[MinorPartsOfSpeech["GT"] = 39] = "GT";
    MinorPartsOfSpeech[MinorPartsOfSpeech["GTE"] = 40] = "GTE";
    MinorPartsOfSpeech[MinorPartsOfSpeech["LTE"] = 41] = "LTE";
    MinorPartsOfSpeech[MinorPartsOfSpeech["EQ"] = 42] = "EQ";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NEQ"] = 43] = "NEQ";
    MinorPartsOfSpeech[MinorPartsOfSpeech["PLUS"] = 44] = "PLUS";
    MinorPartsOfSpeech[MinorPartsOfSpeech["MINUS"] = 45] = "MINUS";
    MinorPartsOfSpeech[MinorPartsOfSpeech["DIV"] = 46] = "DIV";
    MinorPartsOfSpeech[MinorPartsOfSpeech["MUL"] = 47] = "MUL";
    MinorPartsOfSpeech[MinorPartsOfSpeech["POW"] = 48] = "POW";
    MinorPartsOfSpeech[MinorPartsOfSpeech["SEP"] = 49] = "SEP";
    MinorPartsOfSpeech[MinorPartsOfSpeech["POS"] = 50] = "POS";
    // Wh- word
    MinorPartsOfSpeech[MinorPartsOfSpeech["WDT"] = 51] = "WDT";
    MinorPartsOfSpeech[MinorPartsOfSpeech["WP"] = 52] = "WP";
    MinorPartsOfSpeech[MinorPartsOfSpeech["WPO"] = 53] = "WPO";
    MinorPartsOfSpeech[MinorPartsOfSpeech["WRB"] = 54] = "WRB"; // Wh-adverb (however whenever where why)
})(MinorPartsOfSpeech || (MinorPartsOfSpeech = {}));
function newToken(text) {
    var token = formToken({ ix: 0, text: text });
    token.properties.push(Properties.IMPLICIT);
    return token;
}
function cloneToken(token) {
    var clone = {
        ix: token.ix,
        originalWord: token.originalWord,
        normalizedWord: token.normalizedWord,
        POS: token.POS,
        properties: [],
    };
    token.properties.map(function (property) { return clone.properties.push(property); });
    return clone;
}
var Properties;
(function (Properties) {
    // Node properties
    Properties[Properties["ROOT"] = 0] = "ROOT";
    // EVE attributes
    Properties[Properties["ENTITY"] = 1] = "ENTITY";
    Properties[Properties["COLLECTION"] = 2] = "COLLECTION";
    Properties[Properties["ATTRIBUTE"] = 3] = "ATTRIBUTE";
    // Function properties
    Properties[Properties["FUNCTION"] = 4] = "FUNCTION";
    Properties[Properties["OUTPUT"] = 5] = "OUTPUT";
    Properties[Properties["INPUT"] = 6] = "INPUT";
    Properties[Properties["ARGUMENT"] = 7] = "ARGUMENT";
    Properties[Properties["AGGREGATE"] = 8] = "AGGREGATE";
    Properties[Properties["CALCULATE"] = 9] = "CALCULATE";
    Properties[Properties["OPERATOR"] = 10] = "OPERATOR";
    // Token properties
    Properties[Properties["QUANTITY"] = 11] = "QUANTITY";
    Properties[Properties["PROPER"] = 12] = "PROPER";
    Properties[Properties["PLURAL"] = 13] = "PLURAL";
    Properties[Properties["POSSESSIVE"] = 14] = "POSSESSIVE";
    Properties[Properties["BACKRELATIONSHIP"] = 15] = "BACKRELATIONSHIP";
    Properties[Properties["COMPARATIVE"] = 16] = "COMPARATIVE";
    Properties[Properties["SUPERLATIVE"] = 17] = "SUPERLATIVE";
    Properties[Properties["PRONOUN"] = 18] = "PRONOUN";
    Properties[Properties["SEPARATOR"] = 19] = "SEPARATOR";
    Properties[Properties["CONJUNCTION"] = 20] = "CONJUNCTION";
    Properties[Properties["QUOTED"] = 21] = "QUOTED";
    Properties[Properties["SETTER"] = 22] = "SETTER";
    Properties[Properties["SUBSUMED"] = 23] = "SUBSUMED";
    Properties[Properties["COMPOUND"] = 24] = "COMPOUND";
    // Modifiers
    Properties[Properties["NEGATES"] = 25] = "NEGATES";
    Properties[Properties["GROUPING"] = 26] = "GROUPING";
    Properties[Properties["IMPLICIT"] = 27] = "IMPLICIT";
    Properties[Properties["STOPPARSE"] = 28] = "STOPPARSE";
})(Properties || (Properties = {}));
// take an input string, extract tokens
function formToken(word) {
    // Every word is tagged a noun unless some rule says otherwise
    var POS = MinorPartsOfSpeech.NN;
    var properties = [];
    var originalWord = word.text;
    var normalizedWord = originalWord;
    var found = false;
    var upperCaseLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
    var lowerCaseLetters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'];
    var digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
    var separators = [',', ':', ';', '"'];
    var operators = ['+', '-', '*', '/', '^'];
    var comparators = ['>', '>=', '<', '<=', '=', '!='];
    // Most of the following vectors were taken from NLP Compromise
    // https://github.com/nlp-compromise/nlp_compromise
    // Copyright (c) 2016 Spencer Kelly: 
    // Licensed under the MIT License: https://github.com/nlp-compromise/nlp_compromise/blob/master/LICENSE.txt
    var preDeterminers = ['all'];
    var determiners = ['this', 'any', 'enough', 'each', 'every', 'these', 'another', 'plenty', 'whichever', 'neither', 'an', 'a', 'least', 'own', 'few', 'both', 'those', 'the', 'that', 'various', 'what', 'either', 'much', 'some', 'else', 'no'];
    var copulae = ['am', 'is', 'are', 'was', 'were', 'as', 'am', 'be', 'has', 'become', 'became', 'seemed', 'seems', 'seeming'];
    var conjunctions = ['yet', 'therefore', 'or', 'while', 'nor', 'whether', 'though', 'because', 'but', 'for', 'and', 'if', 'before', 'although', 'plus', 'versus', 'not'];
    var prepositions = ['with', 'until', 'onto', 'of', 'into', 'out', 'except', 'across', 'by', 'between', 'at', 'down', 'as', 'from', 'around', 'among', 'upon', 'amid', 'to', 'along', 'since', 'about', 'off', 'on', 'within', 'in', 'during', 'per', 'without', 'throughout', 'through', 'than', 'via', 'up', 'unlike', 'despite', 'below', 'unless', 'towards', 'besides', 'after', 'whereas', 'amongst', 'atop', 'barring', 'circa', 'mid', 'midst', 'notwithstanding', 'sans', 'thru', 'till', 'versus'];
    var possessivePronouns = ['mine', 'something', 'none', 'anything', 'anyone', 'theirs', 'himself', 'ours', 'his', 'my', 'their', 'yours', 'your', 'our', 'its', 'nothing', 'herself', 'hers', 'themselves', 'everything', 'myself', 'itself', 'her'];
    var personalPronouns = ['it', 'they', 'i', 'them', 'you', 'she', 'me', 'he', 'him', 'ourselves', 'us', 'we', 'yourself'];
    var modals = ['can', 'may', 'could', 'might', 'will', 'would', 'must', 'shall', 'should', 'ought'];
    var whPronouns = ['who', 'what', 'whom'];
    var whDeterminers = ['whatever', 'which'];
    var whPossessivePronoun = ['whose'];
    var whAdverbs = ['how', 'when', 'however', 'whenever', 'where', 'why'];
    // We have three cases: the word is a symbol (of which there are various kinds), a number, or a string
    // ----------------------
    // Case 1: handle symbols
    // ----------------------
    if (!found) {
        if (operators.indexOf(originalWord) >= 0) {
            found = true;
            properties.push(Properties.OPERATOR);
            switch (originalWord) {
                case "+":
                    POS = MinorPartsOfSpeech.PLUS;
                    break;
                case "-":
                    POS = MinorPartsOfSpeech.MINUS;
                    break;
                case "*":
                    POS = MinorPartsOfSpeech.MUL;
                    break;
                case "/":
                    POS = MinorPartsOfSpeech.DIV;
                    break;
                case "^":
                    POS = MinorPartsOfSpeech.POW;
                    break;
            }
        }
        else if (comparators.indexOf(originalWord) >= 0) {
            found = true;
            properties.push(Properties.COMPARATIVE);
            switch (originalWord) {
                case ">":
                    POS = MinorPartsOfSpeech.GT;
                    break;
                case ">=":
                    POS = MinorPartsOfSpeech.GTE;
                    break;
                case "<":
                    POS = MinorPartsOfSpeech.LT;
                    break;
                case "<=":
                    POS = MinorPartsOfSpeech.LTE;
                    break;
                case "=":
                    POS = MinorPartsOfSpeech.EQ;
                    break;
                case "!=":
                    POS = MinorPartsOfSpeech.NEQ;
                    break;
            }
        }
        else if (separators.indexOf(originalWord) >= 0) {
            found = true;
            properties.push(Properties.SEPARATOR);
            POS = MinorPartsOfSpeech.SEP;
            if (originalWord === "\"") {
                properties.push(Properties.QUOTED);
            }
        }
        else if (originalWord === "'s" || originalWord === "'") {
            properties.push(Properties.POSSESSIVE);
            POS = MinorPartsOfSpeech.POS;
        }
    }
    // ----------------------
    // Case 2: handle numbers
    // ----------------------
    if (!found) {
        if (digits.indexOf(originalWord[0]) >= 0 && isNumeric(originalWord)) {
            found = true;
            properties.push(Properties.QUANTITY);
            POS = MinorPartsOfSpeech.NU;
        }
    }
    // ----------------------
    // Case 3: handle strings
    // ----------------------
    if (!found) {
        // Normalize the word
        normalizedWord = normalizedWord.toLowerCase();
        var before = normalizedWord;
        normalizedWord = singularize(normalizedWord);
        if (before !== normalizedWord) {
            properties.push(Properties.PLURAL);
        }
        // Find the POS in the dictionary, apply some properties based on the word
        // Determiners
        if (determiners.indexOf(normalizedWord) >= 0) {
            POS = MinorPartsOfSpeech.DT;
        }
        else if (modals.indexOf(normalizedWord) >= 0) {
            POS = MinorPartsOfSpeech.MD;
        }
        else if (preDeterminers.indexOf(normalizedWord) >= 0) {
            POS = MinorPartsOfSpeech.PDT;
        }
        else if (copulae.indexOf(normalizedWord) >= 0) {
            POS = MinorPartsOfSpeech.CP;
        }
        else if (prepositions.indexOf(normalizedWord) >= 0) {
            POS = MinorPartsOfSpeech.IN;
        }
        else if (personalPronouns.indexOf(normalizedWord) >= 0) {
            POS = MinorPartsOfSpeech.PRP;
            properties.push(Properties.PRONOUN);
        }
        else if (possessivePronouns.indexOf(normalizedWord) >= 0) {
            POS = MinorPartsOfSpeech.PRP;
            properties.push(Properties.PRONOUN);
            properties.push(Properties.POSSESSIVE);
        }
        else if (conjunctions.indexOf(normalizedWord) >= 0) {
            POS = MinorPartsOfSpeech.CC;
            properties.push(Properties.CONJUNCTION);
        }
        else if (whPronouns.indexOf(normalizedWord) >= 0) {
            POS = MinorPartsOfSpeech.WP;
        }
        else if (whDeterminers.indexOf(normalizedWord) >= 0) {
            POS = MinorPartsOfSpeech.WDT;
        }
        else if (whAdverbs.indexOf(normalizedWord) >= 0) {
            POS = MinorPartsOfSpeech.WRB;
        }
        else if (whPossessivePronoun.indexOf(normalizedWord) >= 0) {
            POS = MinorPartsOfSpeech.WPO;
            properties.push(Properties.POSSESSIVE);
        }
        // Set grouping property
        var groupingWords = ['per', 'by'];
        var negatingWords = ['except', 'without', 'sans', 'not', 'nor', 'neither', 'no'];
        var pluralWords = ['their'];
        if (groupingWords.indexOf(normalizedWord) >= 0) {
            properties.push(Properties.GROUPING);
        }
        else if (negatingWords.indexOf(normalizedWord) >= 0) {
            properties.push(Properties.NEGATES);
        }
        else if (pluralWords.indexOf(normalizedWord) >= 0) {
            properties.push(Properties.PLURAL);
        }
        // If the word is still a noun, if it is upper case than it is a proper noun 
        if (getMajorPOS(POS) === MajorPartsOfSpeech.NOUN) {
            if (upperCaseLetters.indexOf(originalWord[0]) >= 0) {
                properties.push(Properties.PROPER);
            }
        }
    }
    // Build the token
    var token = {
        ix: word.ix,
        originalWord: word.text,
        normalizedWord: normalizedWord,
        POS: POS,
        properties: properties,
    };
    return token;
}
function getMajorPOS(minorPartOfSpeech) {
    // ROOT
    if (minorPartOfSpeech === MinorPartsOfSpeech.ROOT) {
        return MajorPartsOfSpeech.ROOT;
    }
    // Verb
    var verbs = ['VB', 'VBD', 'VBN', 'VBP', 'VBZ', 'VBF', 'VBG'];
    if (verbs.indexOf(MinorPartsOfSpeech[minorPartOfSpeech]) >= 0) {
        return MajorPartsOfSpeech.VERB;
    }
    // Adjective
    var adjectives = ['JJ', 'JJR', 'JJS'];
    if (adjectives.indexOf(MinorPartsOfSpeech[minorPartOfSpeech]) >= 0) {
        return MajorPartsOfSpeech.ADJECTIVE;
    }
    // Adverb
    var adverbs = ['RB', 'RBR', 'RBS'];
    if (adverbs.indexOf(MinorPartsOfSpeech[minorPartOfSpeech]) >= 0) {
        return MajorPartsOfSpeech.ADVERB;
    }
    // Noun
    var nouns = ['NN', 'NNA', 'NNPA', 'NNAB', 'NNP', 'NNPS', 'NNS', 'NNQ', 'NNO', 'NG', 'PRP', 'PP'];
    if (nouns.indexOf(MinorPartsOfSpeech[minorPartOfSpeech]) >= 0) {
        return MajorPartsOfSpeech.NOUN;
    }
    // Value
    var values = ['CD', 'DA', 'NU'];
    if (values.indexOf(MinorPartsOfSpeech[minorPartOfSpeech]) >= 0) {
        return MajorPartsOfSpeech.VALUE;
    }
    // Glue
    var glues = ['FW', 'IN', 'CP', 'MD', 'CC', 'PDT', 'DT', 'UH', 'EX'];
    if (glues.indexOf(MinorPartsOfSpeech[minorPartOfSpeech]) >= 0) {
        return MajorPartsOfSpeech.GLUE;
    }
    // Symbol
    var symbols = ['LT', 'GT', 'LTE', 'GTE', 'EQ', 'NEQ',
        'PLUS', 'MINUS', 'DIV', 'MUL', 'POW',
        'SEP', 'POS'];
    if (symbols.indexOf(MinorPartsOfSpeech[minorPartOfSpeech]) >= 0) {
        return MajorPartsOfSpeech.SYMBOL;
    }
    // Wh-Word
    var whWords = ['WDT', 'WP', 'WPO', 'WRB'];
    if (whWords.indexOf(MinorPartsOfSpeech[minorPartOfSpeech]) >= 0) {
        return MajorPartsOfSpeech.WHWORD;
    }
}
// Wrap pluralize to special case certain words it gets wrong
// @HACK data singularizes to datum, which is correct, but we
// have a collection called test data, which NLQP turns into test datum
function singularize(word) {
    // split word at spaces
    var words = word.split(" ");
    if (words.length === 1) {
        var specialCases = ["his", "times", "has", "downstairs", "its", "'s", "data"];
        for (var _i = 0; _i < specialCases.length; _i++) {
            var specialCase = specialCases[_i];
            if (specialCase === word) {
                return word;
            }
        }
        return pluralize(word, 1);
    }
    return words.map(singularize).join(" ");
}
exports.singularize = singularize;
function cloneNode(node) {
    var token = cloneToken(node.token);
    var cloneNode = newNode(token);
    cloneNode.entity = node.entity;
    cloneNode.collection = node.collection;
    cloneNode.attribute = node.attribute;
    cloneNode.fxn = node.fxn;
    cloneNode.found = node.found;
    node.properties.map(function (property) { return cloneNode.properties.push(property); });
    return cloneNode;
}
function newNode(token) {
    var node = {
        ix: token.ix,
        name: token.normalizedWord,
        parent: undefined,
        children: [],
        token: token,
        properties: token.properties,
        relationships: [],
        representations: {
            entity: undefined,
            collection: undefined,
            attribute: undefined,
            fxn: undefined,
        },
        found: false,
        foundReps: false,
        hasProperty: hasProperty,
        toString: nodeToString,
        next: nextNode,
        prev: previousNode,
        addChild: addChild,
    };
    token.node = node;
    function hasProperty(property) {
        var found = node.properties.indexOf(property);
        if (found !== -1) {
            return true;
        }
        else {
            return false;
        }
    }
    function nextNode() {
        var token = node.token;
        var nextToken = token.next;
        if (nextToken !== undefined) {
            return nextToken.node;
        }
        return undefined;
    }
    function previousNode() {
        var token = node.token;
        var prevToken = token.prev;
        if (prevToken !== undefined) {
            return prevToken.node;
        }
        return undefined;
    }
    function addChild(newChild) {
        node.children.push(newChild);
        newChild.parent = node;
    }
    function nodeToString(depth) {
        if (depth === undefined) {
            depth = 0;
        }
        var childrenStrings = node.children.map(function (childNode) { return childNode.toString(depth + 1); }).join("\n");
        var children = childrenStrings.length > 0 ? "\n" + childrenStrings : "";
        var indent = Array(depth + 1).join(" ");
        var index = node.ix === undefined ? "+ " : node.ix + ": ";
        var properties = node.properties.length === 0 ? "" : "(" + node.properties.map(function (property) { return Properties[property]; }).join("|") + ")";
        var attribute = node.attribute === undefined ? "" : "[" + node.attribute.variable + "]";
        var entity = node.entity === undefined ? "" : "[" + node.entity.displayName + "]";
        var collection = node.collection === undefined ? "" : "[" + node.collection.displayName + "]";
        var fxn = node.fxn === undefined ? "" : "[" + node.fxn.name + "]";
        var found = node.found ? "*" : " ";
        properties = properties.length === 2 ? "" : properties;
        var nodeString = "|" + found + indent + index + node.name + " " + fxn + entity + collection + attribute + " " + properties + children;
        return nodeString;
    }
    return node;
}
//------------------------------------
// Various node manipulation functions
//------------------------------------
// Removes the node and its children from the tree, 
// and makes it a child of the target node
function reroot(node, target) {
    node.parent.children.splice(node.parent.children.indexOf(node), 1);
    target.addChild(node);
}
// Removes a node from the tree
// The node's children get added to its parent
// returns the node or undefined if the operation failed
function removeNode(node) {
    if (node.hasProperty(Properties.ROOT)) {
        return undefined;
    }
    if (node.parent === undefined && node.children.length === 0) {
        return undefined;
    }
    var children = node.children;
    var parent = node.parent;
    // Rewire
    if (parent !== undefined) {
        parent.children = parent.children.concat(children);
        parent.children.sort(function (a, b) { return a.ix - b.ix; });
        parent.children.splice(parent.children.indexOf(node), 1);
        children.map(function (child) { return child.parent = parent; });
    }
    // Get rid of references on current node
    node.parent = undefined;
    node.children = [];
    return node;
}
function removeBranch(node) {
    var parent = node.parent;
    if (parent !== undefined) {
        parent.children.splice(parent.children.indexOf(node), 1);
        node.parent = undefined;
        return node;
    }
    return undefined;
}
// Returns the first ancestor node that has been found
function previouslyMatched(node, ignoreFunctions) {
    if (ignoreFunctions === undefined) {
        ignoreFunctions = false;
    }
    if (node.parent === undefined) {
        return undefined;
    }
    else if (!ignoreFunctions &&
        (node.parent.hasProperty(Properties.SETTER) ||
            (node.parent.hasProperty(Properties.FUNCTION) && !node.parent.hasProperty(Properties.CONJUNCTION)))) {
        return undefined;
    }
    else if (node.parent.hasProperty(Properties.ENTITY) ||
        node.parent.hasProperty(Properties.ATTRIBUTE) ||
        node.parent.hasProperty(Properties.COLLECTION)) {
        return node.parent;
    }
    else {
        return previouslyMatched(node.parent, ignoreFunctions);
    }
}
// Returns the first ancestor node that has been found
function previouslyMatchedEntityOrCollection(node, ignoreFunctions) {
    if (ignoreFunctions === undefined) {
        ignoreFunctions = false;
    }
    if (node.parent === undefined) {
        return undefined;
    }
    else if (!ignoreFunctions &&
        (node.parent.hasProperty(Properties.SETTER) ||
            (node.parent.hasProperty(Properties.FUNCTION) && !node.parent.hasProperty(Properties.CONJUNCTION)))) {
        return undefined;
    }
    else if (node.parent.hasProperty(Properties.ENTITY) ||
        node.parent.hasProperty(Properties.COLLECTION)) {
        return node.parent;
    }
    else {
        return previouslyMatchedEntityOrCollection(node.parent, ignoreFunctions);
    }
}
// Returns the first ancestor node that has been found
function previouslyMatchedAttribute(node, ignoreFunctions) {
    if (ignoreFunctions === undefined) {
        ignoreFunctions = false;
    }
    if (node.parent === undefined) {
        return undefined;
    }
    else if (!ignoreFunctions &&
        (node.parent.hasProperty(Properties.SETTER) ||
            (node.parent.hasProperty(Properties.FUNCTION) && !node.parent.hasProperty(Properties.CONJUNCTION)))) {
        return undefined;
    }
    else if (node.parent.hasProperty(Properties.ATTRIBUTE)) {
        return node.parent;
    }
    else {
        return previouslyMatchedAttribute(node.parent, ignoreFunctions);
    }
}
// Inserts a node after the target, moving all of the
// target's children to the node
// Before: [Target] -> [Children]
// After:  [Target] -> [Node] -> [Children]
function insertAfterNode(node, target) {
    node.parent = target;
    node.children = target.children;
    target.children.map(function (n) { return n.parent = node; });
    target.children = [node];
}
function insertBeforeNode(node, target) {
    var parent = target.parent;
    if (parent !== undefined) {
        parent.addChild(node);
        parent.children.splice(parent.children.indexOf(target), 1);
        node.addChild(target);
    }
}
// Find all leaf nodes stemming from a given node
function findLeafNodes(node) {
    if (node.children.length === 0) {
        return [node];
    }
    else {
        var foundLeafs = node.children.map(findLeafNodes);
        var flatLeafs = flattenNestedArray(foundLeafs);
        return flatLeafs;
    }
}
/*function moveNode(node: Node, target: Node): void {
  if (node.hasProperty(Properties.ROOT)) {
    return;
  }
  let parent = node.parent;
  parent.children.splice(parent.children.indexOf(node),1);
  parent.children = parent.children.concat(node.children);
  node.children.map((child) => child.parent = parent);
  node.children = [];
  node.parent = target;
  target.children.push(node);
}*/
// Finds a parent node with the specified property, 
// returns undefined if no node was found
function findParentWithProperty(node, property) {
    if (node.parent === undefined) {
        return undefined;
    }
    else if (node.parent.hasProperty(property)) {
        return node.parent;
    }
    else {
        return findParentWithProperty(node.parent, property);
    }
}
// Finds a parent node with the specified property, 
// returns undefined if no node was found
function findChildWithProperty(node, property) {
    if (node.children.length === 0) {
        return undefined;
    }
    if (node.hasProperty(property)) {
        return node;
    }
    else {
        var childrenWithProperty = node.children.filter(function (child) { return child.hasProperty(property); });
        if (childrenWithProperty !== undefined) {
            return childrenWithProperty[0];
        }
        else {
            var results = node.children.map(function (child) { return findChildWithProperty(child, property); }).filter(function (result) { return result !== undefined; });
            if (results.length > 0) {
                return results[0];
            }
        }
    }
}
// Finds a parent node with the specified POS, 
// returns undefined if no node was found
function findParentWithPOS(node, majorPOS) {
    if (getMajorPOS(node.token.POS) === MajorPartsOfSpeech.ROOT) {
        return undefined;
    }
    if (getMajorPOS(node.parent.token.POS) === majorPOS) {
        return node.parent;
    }
    else {
        return findParentWithPOS(node.parent, majorPOS);
    }
}
/*
// Sets node to be a sibling of its parent
// Before: [Grandparent] -> [Parent] -> [Node]
// After:  [Grandparent] -> [Parent]
//                       -> [Node]
function promoteNode(node: Node): void {
  if (node.parent.hasProperty(Properties.ROOT)) {
    return;
  }
  let newSibling = node.parent;
  let newParent = newSibling.parent;
  // Set parent
  node.parent = newParent;
  // Remove node from parent's children
  newSibling.children.splice(newSibling.children.indexOf(node),1);
  // Add node to new parent's children
  newParent.children.push(node);
}*/
// Makes the node's parent a child of the node.
// The node's grandparent is then the node's parent
// Before: [Grandparent] -> [Parent] -> [Node]
// After: [Grandparen] -> [Node] -> [Parent]
function makeParentChild(node) {
    var parent = node.parent;
    // Do not swap with root
    if (parent.hasProperty(Properties.ROOT)) {
        return;
    }
    // Set parents
    node.parent = parent.parent;
    parent.parent = node;
    // Remove node as a child from parent
    parent.children.splice(parent.children.indexOf(node), 1);
    // Set children
    node.children = node.children.concat(parent);
    node.parent.children.push(node);
    node.parent.children.splice(node.parent.children.indexOf(parent), 1);
}
// Swaps a node with its parent. The node's parent
// is then the parent's parent, and its child is the parent.
// The parent gets the node's children
function swapWithParent(node) {
    var parent = node.parent;
    var pparent = parent.parent;
    if (parent.hasProperty(Properties.ROOT)) {
        return;
    }
    parent.parent = node;
    parent.children = node.children;
    pparent.children.splice(pparent.children.indexOf(parent), 1);
    node.parent = pparent;
    node.children = [parent];
    pparent.children.push(node);
}
function newContext() {
    return {
        entities: [],
        collections: [],
        attributes: [],
        fxns: [],
        groupings: [],
        relationships: [],
        found: [],
        arguments: [],
        maybeEntities: [],
        maybeAttributes: [],
        maybeCollections: [],
        maybeFunctions: [],
        maybeArguments: [],
        nodes: [],
        stateFlags: { list: false, insert: false },
    };
}
(function (FunctionTypes) {
    FunctionTypes[FunctionTypes["FILTER"] = 0] = "FILTER";
    FunctionTypes[FunctionTypes["AGGREGATE"] = 1] = "AGGREGATE";
    FunctionTypes[FunctionTypes["BOOLEAN"] = 2] = "BOOLEAN";
    FunctionTypes[FunctionTypes["CALCULATE"] = 3] = "CALCULATE";
    FunctionTypes[FunctionTypes["INSERT"] = 4] = "INSERT";
    FunctionTypes[FunctionTypes["SELECT"] = 5] = "SELECT";
    FunctionTypes[FunctionTypes["GROUP"] = 6] = "GROUP";
    FunctionTypes[FunctionTypes["NEGATE"] = 7] = "NEGATE";
})(exports.FunctionTypes || (exports.FunctionTypes = {}));
var FunctionTypes = exports.FunctionTypes;
function stringToFunction(word) {
    var all = [Properties.ENTITY, Properties.ATTRIBUTE, Properties.COLLECTION, Properties.FUNCTION, Properties.ROOT];
    var CFA = [Properties.COLLECTION, Properties.FUNCTION, Properties.ATTRIBUTE];
    var filterFields = [{ name: "a", types: [Properties.ATTRIBUTE, Properties.QUANTITY] },
        { name: "b", types: [Properties.ATTRIBUTE, Properties.QUANTITY] }
    ];
    var calculateFields = [{ name: "result", types: [Properties.OUTPUT] },
        { name: "a", types: [Properties.ATTRIBUTE, Properties.QUANTITY] },
        { name: "b", types: [Properties.ATTRIBUTE, Properties.QUANTITY] }
    ];
    switch (word) {
        case ">":
            return { name: ">", type: FunctionTypes.FILTER, fields: filterFields, project: false };
        case "<":
            return { name: "<", type: FunctionTypes.FILTER, fields: filterFields, project: false };
        case ">=":
            return { name: ">=", type: FunctionTypes.FILTER, fields: filterFields, project: false };
        case "<=":
            return { name: "<=", type: FunctionTypes.FILTER, fields: filterFields, project: false };
        case "=":
            return { name: "=", type: FunctionTypes.FILTER, fields: filterFields, project: false };
        case "!=":
            return { name: "!=", type: FunctionTypes.FILTER, fields: filterFields, project: false };
        case "taller":
            return { name: ">", type: FunctionTypes.FILTER, attribute: "height", fields: filterFields, project: false };
        case "shorter":
            return { name: "<", type: FunctionTypes.FILTER, attribute: "length", fields: filterFields, project: false };
        case "longer":
            return { name: ">", type: FunctionTypes.FILTER, attribute: "length", fields: filterFields, project: false };
        case "younger":
            return { name: "<", type: FunctionTypes.FILTER, attribute: "age", fields: filterFields, project: false };
        case "&":
        case "and":
            return { name: "and", type: FunctionTypes.BOOLEAN, fields: [], project: false };
        case "or":
            return { name: "or", type: FunctionTypes.BOOLEAN, fields: [], project: false };
        case "total":
        case "sum":
            return { name: "sum", type: FunctionTypes.AGGREGATE, fields: [{ name: "sum", types: [Properties.OUTPUT] },
                    { name: "value", types: [Properties.ATTRIBUTE] }], project: true };
        case "average":
        case "avg":
        case "mean":
            return { name: "average", type: FunctionTypes.AGGREGATE, fields: [{ name: "average", types: [Properties.OUTPUT] },
                    { name: "value", types: [Properties.ATTRIBUTE] }], project: true };
        case "plus":
        case "add":
        case "+":
            return { name: "+", type: FunctionTypes.CALCULATE, fields: calculateFields, project: true };
        case "subtract":
        case "minus":
        case "-":
            return { name: "-", type: FunctionTypes.CALCULATE, fields: calculateFields, project: true };
        case "times":
        case "multiply":
        case "multiplied":
        case "multiplied by":
        case "*":
            return { name: "*", type: FunctionTypes.CALCULATE, fields: calculateFields, project: true };
        case "divide":
        case "divided":
        case "divided by":
        case "/":
            return { name: "/", type: FunctionTypes.CALCULATE, fields: calculateFields, project: true };
        case "^":
            return { name: "^", type: FunctionTypes.CALCULATE, fields: calculateFields, project: true };
        case "is":
        case "is a":
        case "is an":
            return { name: "insert", type: FunctionTypes.INSERT, fields: [{ name: "entity", types: [Properties.ENTITY] },
                    { name: "attribute", types: [Properties.ATTRIBUTE] },
                    { name: "root", types: all }], project: false };
        case "are":
            return { name: "insert", type: FunctionTypes.INSERT, fields: [{ name: "collection", types: [Properties.COLLECTION] },
                    { name: "collection", types: [Properties.COLLECTION] }], project: false };
        case "his":
        case "hers":
        case "their":
        case "its":
        case "'s":
        case "'":
            return { name: "select", type: FunctionTypes.SELECT, fields: [{ name: "subject", types: [Properties.ENTITY, Properties.COLLECTION] }], project: false };
        case "by":
        case "per":
            return { name: "group", type: FunctionTypes.GROUP, fields: [{ name: "root", types: all },
                    { name: "collection", types: [Properties.COLLECTION] }], project: false };
        case "except":
        case "without":
        case "not":
            return { name: "negate", type: FunctionTypes.NEGATE, fields: [{ name: "negated", types: CFA }], project: false };
        default:
            return undefined;
    }
}
function findFunction(node, context) {
    log("Searching for function: " + node.name);
    var fxn = stringToFunction(node.name);
    if (fxn === undefined) {
        log(" Not Found: " + node.name);
        return false;
    }
    log(" Found: " + fxn.name);
    node.fxn = fxn;
    fxn.node = node;
    // Add arguments to the node
    var args = fxn.fields.map(function (field, i) {
        var argToken = newToken(field.name);
        var argNode = newNode(argToken);
        argNode.properties.push(Properties.ARGUMENT);
        if (fxn.project && i === 0) {
            argNode.properties.push(Properties.OUTPUT);
            argNode.found = true;
            var outputToken = newToken("output" + context.fxns.length);
            var outputNode = newNode(outputToken);
            var outputAttribute = {
                id: outputNode.name,
                displayName: outputNode.name,
                variable: outputNode.name,
                node: outputNode,
                project: false,
            };
            outputNode.attribute = outputAttribute;
            outputNode.properties.push(Properties.OUTPUT);
            outputNode.found = true;
            argNode.addChild(outputNode);
        }
        else {
            argNode.properties.push(Properties.INPUT);
        }
        argNode.properties = argNode.properties.concat(field.types);
        context.arguments.push(argNode);
        return argNode;
    });
    node.properties.push(Properties.FUNCTION);
    for (var _i = 0; _i < args.length; _i++) {
        var arg = args[_i];
        node.addChild(arg);
    }
    node.found = true;
    node.type = NodeTypes.FUNCTION;
    context.fxns.push(node);
    return true;
}
function formTree(node, tree, context) {
    log("--------------------------------");
    log(node.toString());
    log(context);
    if (context.nodes.indexOf(node) === -1) {
        context.nodes.push(node);
    }
    // Don't do anything with subsumed nodes
    if (node.hasProperty(Properties.SUBSUMED)) {
        log("Skipping...");
        return { tree: tree, context: context };
    }
    // -------------------------------------
    // Step 1: Build n-grams
    // -------------------------------------
    log("ngrams:");
    // Flatten the tree
    var nextNode = tree;
    var nodes = [];
    while (nextNode !== undefined) {
        nodes.push(nextNode);
        nextNode = nextNode.next();
    }
    // Build ngrams
    // Initialize the ngrams with 1-grams
    var ngrams = nodes.map(function (node) { return [node]; });
    // Shift off the root node
    ngrams.shift();
    var n = 4;
    var m = ngrams.length;
    var offset = 0;
    for (var i = 0; i < n - 1; i++) {
        var newNgrams = [];
        for (var j = offset; j < ngrams.length; j++) {
            var thisNgram = ngrams[j];
            var nextNgram = ngrams[j + 1];
            // Break at the end of the ngrams
            if (nextNgram === undefined) {
                break;
            }
            // From the new ngram
            var newNgram = thisNgram.concat([nextNgram[nextNgram.length - 1]]);
            newNgrams.push(newNgram);
        }
        offset = ngrams.length;
        ngrams = ngrams.concat(newNgrams);
    }
    // Check each ngram for a display name
    var matchedNgrams = [];
    for (var i = ngrams.length - 1; i >= 0; i--) {
        var ngram = ngrams[i];
        var allFound_1 = ngram.every(function (node) { return node.found; });
        if (allFound_1 !== true) {
            var displayName = ngram.map(function (node) { return node.name; }).join(" ").replace(/ '/g, '\'');
            log(displayName);
            var foundName = app_1.eve.findOne("index name", { name: displayName });
            // If the display name is in the system, mark all the nodes as found 
            if (foundName !== undefined) {
                ngram.map(function (node) { return node.found = true; });
                matchedNgrams.push(ngram);
            }
            else {
                var foundAttribute = app_1.eve.findOne("entity eavs", { attribute: displayName });
                if (foundAttribute !== undefined) {
                    ngram.map(function (node) { return node.found = true; });
                    matchedNgrams.push(ngram);
                }
                else {
                    var fxn = stringToFunction(displayName);
                    if (fxn !== undefined) {
                        ngram.map(function (node) { return node.found = true; });
                        // "engineers are employees" asserts that every engineer is also an employee
                        // "engineers that are employees" is asking for the intersection of engineers and employees
                        // "that" is a determiner, which cnages the meaning of the sentence, so we prevent 
                        // an insert using this heuristic 
                        if (fxn.type === FunctionTypes.INSERT &&
                            (ngram[0].prev().token.POS === MinorPartsOfSpeech.DT ||
                                getMajorPOS(ngram[0].prev().token.POS) === MajorPartsOfSpeech.WHWORD)) {
                            return { tree: tree, context: context };
                        }
                        else {
                            matchedNgrams.push(ngram);
                        }
                    }
                }
            }
        }
    }
    // Turn matched ngrams into compound nodes  
    for (var _i = 0; _i < matchedNgrams.length; _i++) {
        var ngram = matchedNgrams[_i];
        // Don't do anything for 1-grams
        if (ngram.length === 1) {
            ngram[0].found = false;
            continue;
        }
        var displayName = ngram.map(function (node) { return node.name; }).join(" ").replace(/ '/g, '\'');
        log("Creating compound node: " + displayName);
        var lastGram = ngram[ngram.length - 1];
        var compoundToken = newToken(displayName);
        compoundToken.prev = ngram[0].token.prev;
        var compoundNode = newNode(compoundToken);
        compoundNode.constituents = ngram;
        compoundNode.constituents.map(function (node) { return node.properties.push(Properties.SUBSUMED); });
        compoundNode.ix = lastGram.ix;
        // Inherit properties from the nodes
        compoundNode.properties = lastGram.properties;
        compoundNode.properties.push(Properties.COMPOUND);
        compoundNode.properties.splice(compoundNode.properties.indexOf(Properties.SUBSUMED), 1); // Don't inherit subsumed property
        // The compound node results from the new node,
        // so the compound node replaces it
        node = compoundNode;
    }
    log('-------');
    // -------------------------------------
    // Step 2: Identify the node
    // -------------------------------------
    // If the node is a quantity, just build an attribute
    if (node.hasProperty(Properties.QUANTITY)) {
        var quantityAttribute = {
            id: node.name,
            displayName: node.name,
            variable: node.name,
            node: node,
            project: false,
            handled: true,
        };
        node.quantity = parseFloat(node.name);
        node.properties.push(Properties.ATTRIBUTE);
        node.type = NodeTypes.NUMBER;
        node.attribute = quantityAttribute;
        node.found = true;
    }
    // Find a collection, entity, attribute, or function
    if (!node.found) {
        findCollection(node, context);
        if (!node.found) {
            findAttribute(node, context);
            if (!node.found) {
                findEntity(node, context);
                if (!node.found) {
                    findFunction(node, context);
                    if (!node.found) {
                        log(node.name + " was not found anywhere!");
                    }
                }
            }
        }
    }
    // If the node wasn't found at all, don't try to place it anywhere
    if (!node.found && context.stateFlags.insert === false) {
        context.maybeAttributes.push(node);
        return { tree: tree, context: context };
    }
    else if (!node.found && context.stateFlags.insert === true) {
        var root = context.arguments.filter(function (a) { return a.hasProperty(Properties.ROOT); }).pop();
        if (root !== undefined) {
            node.found = true;
            addNodeToFunction(node, root.parent, context);
        }
        context.maybeAttributes.push(node);
        return { tree: tree, context: context };
    }
    else if (node.found && !node.foundReps) {
        findAlternativeRepresentations(node);
    }
    // -------------------------------------
    // Step 3: Insert the node into the tree
    // -------------------------------------
    log("Matching: " + node.name);
    // If the node is compound, replace the last subsumed node with it
    if (node.hasProperty(Properties.COMPOUND)) {
        var subsumedNode = node.constituents[node.constituents.length - 2];
        if (subsumedNode.parent !== undefined) {
            log("Replacing \"" + subsumedNode.name + "\" with \"" + node.name + "\"");
            insertBeforeNode(node, subsumedNode);
            removeBranch(subsumedNode);
            var children = subsumedNode.children;
            // Relinquish children
            for (var _a = 0; _a < children.length; _a++) {
                var child = children[_a];
                if (child.hasProperty(Properties.ARGUMENT)) {
                    for (var _b = 0, _c = child.children; _b < _c.length; _b++) {
                        var grandChild = _c[_b];
                        removeBranch(grandChild);
                        console.log(grandChild);
                        formTree(grandChild, tree, context);
                    }
                }
                else {
                    removeBranch(child);
                    formTree(child, tree, context);
                }
            }
            // filter context
            context.fxns = context.fxns.filter(function (f) { return !f.hasProperty(Properties.SUBSUMED); });
            context.arguments = context.arguments.filter(function (a) { return !a.parent.hasProperty(Properties.SUBSUMED); });
            return { tree: tree, context: context };
        }
    }
    // Handle functions
    if (node.hasProperty(Properties.FUNCTION)) {
        // Find an argument to attach the node to
        var functionArg = context.arguments.filter(function (n) { return n.hasProperty(Properties.FUNCTION) && n.parent !== node && !n.found; });
        if (functionArg.length > 0) {
            var arg = functionArg.pop();
            addNodeToFunction(node, arg.parent, context);
        }
        else {
            tree.addChild(node);
        }
        // If the node is a grouping node, attach the old root to the new one
        if (node.fxn.type === FunctionTypes.GROUP) {
            var newRoot = node.children[0];
            for (var _d = 0, _e = tree.children; _d < _e.length; _d++) {
                var child = _e[_d];
                if (child === node) {
                    continue;
                }
                else {
                    reroot(child, newRoot);
                }
                newRoot.found = true;
            }
        }
        else if (node.fxn.type === FunctionTypes.INSERT) {
            // Find an entity
            var entity = context.found.filter(function (n) { return n.hasProperty(Properties.ENTITY) && n.ix < node.ix; }).pop();
            if (entity !== undefined) {
                removeNode(entity);
                addNodeToFunction(entity, node, context);
                // Find an attribute
                var attribute = context.found.filter(function (n) { return n.hasProperty(Properties.ATTRIBUTE) && n.ix > entity.ix; }).pop();
                if (attribute !== undefined) {
                    removeNode(attribute);
                    addNodeToFunction(attribute, node, context);
                }
                else {
                    var attributeNodes = context.nodes.filter(function (ma) { return ma.ix > entity.ix + 1; });
                    attributeNodes.pop();
                    if (attributeNodes.length > 0) {
                        attributeNodes.map(removeNode);
                        var nName = attributeNodes.map(function (ma) { return ma.name; }).join(" ");
                        var nToken = newToken(nName);
                        nToken.ix = attributeNodes[0].ix;
                        var nNode = newNode(nToken);
                        nNode.type = NodeTypes.STRING;
                        nNode.found = true;
                        nNode.properties.push(Properties.ATTRIBUTE);
                        addNodeToFunction(nNode, node, context);
                    }
                }
            }
        }
        else if (node.fxn.type === FunctionTypes.FILTER) {
            // If an attribute is specified, create an attribute node for each one
            if (node.fxn.attribute !== undefined) {
                for (var i = 0; i < node.fxn.fields.length; i++) {
                    var nToken = newToken(node.fxn.attribute);
                    var nNode = newNode(nToken);
                    formTree(nNode, tree, context);
                }
            }
            else {
                var orphans = context.found.filter(function (n) { return n.hasProperty(Properties.ATTRIBUTE); });
                for (var _f = 0; _f < orphans.length; _f++) {
                    var orphan = orphans[_f];
                    removeNode(orphan);
                    formTree(orphan, tree, context);
                    // Break when all args are filled
                    if (node.children.every(function (n) { return n.found; })) {
                        break;
                    }
                }
            }
        }
        else if (node.fxn.type === FunctionTypes.NEGATE) {
        }
        else if (node.fxn.type === FunctionTypes.CALCULATE) {
            var QAs = context.nodes.filter(function (n) { return n.hasProperty(Properties.ATTRIBUTE) || n.hasProperty(Properties.QUANTITY); });
            for (var _g = 0; _g < QAs.length; _g++) {
                var qa = QAs[_g];
                if (qa.parent.hasProperty(Properties.ARGUMENT)) {
                    continue;
                }
                removeNode(qa);
                formTree(qa, tree, context);
                if (node.children.every(function (n) { return n.found; })) {
                    break;
                }
            }
        }
        else {
            if (node.fxn.fields.length > 0) {
                for (var i = context.found.length - 1; i >= 0; i--) {
                    var foundNode = context.found[i];
                    removeNode(foundNode);
                    formTree(foundNode, tree, context);
                    // Break when all args are filled
                    if (node.children.every(function (n) { return n.found; })) {
                        break;
                    }
                }
            }
        }
    }
    else {
        // Find a relationship if we have to
        var relationship = { type: RelationshipTypes.NONE };
        if (node.relationships.length === 0) {
            //let orphans = tree.children.filter((child) => child.relationships.length === 0 && child.children.length === 0);  
            for (var i = context.found.length - 1; i >= 0; i--) {
                var foundNode = context.found[i];
                if (node.relationships.length === 0) {
                    removeNode(node);
                }
                relationship = findRelationship(node, foundNode, context);
                if (relationship.type !== RelationshipTypes.NONE) {
                    break;
                }
                else if (relationship.type === RelationshipTypes.NONE) {
                    if (foundNode.hasProperty(Properties.POSSESSIVE)) {
                        context.maybeAttributes.push(node);
                    }
                }
            }
        }
        // Place the node onto a function if one is open
        var openFunctions = context.fxns.filter(function (fxn) { return !fxn.children.every(function (c) { return c.found; }); });
        for (var _h = 0; _h < openFunctions.length; _h++) {
            var fxnNode = openFunctions[_h];
            var added = addNodeToFunction(node, fxnNode, context);
            if (added) {
                relationship.type = RelationshipTypes.DIRECT;
                break;
            }
        }
        // If no relationships were found, stick the node onto the root
        if (node.parent === undefined && node.relationships.length === 0) {
            tree.addChild(node);
        }
        else if (node.parent === undefined) {
            var relatedNodes = node.relationships.map(function (r) { return r.nodes; });
            var flatRelatedNodes = flattenNestedArray(relatedNodes);
            var relatedAttribute = flatRelatedNodes.filter(function (n) { return n.hasProperty(Properties.ATTRIBUTE); }).shift();
            if (relatedAttribute !== undefined) {
                var root = findParentWithProperty(relatedAttribute, Properties.ROOT);
                if (root !== undefined) {
                    root.addChild(node);
                }
                else {
                    tree.addChild(node);
                }
            }
            else {
                tree.addChild(node);
            }
        }
        // Finally add any nodes implicit in the relationship    
        if (relationship.implicitNodes !== undefined && relationship.implicitNodes.length > 0) {
            for (var _j = 0, _k = relationship.implicitNodes; _j < _k.length; _j++) {
                var implNode = _k[_j];
                formTree(implNode, tree, context);
            }
        }
    }
    // Switch state
    if (node.fxn && node.fxn.type === FunctionTypes.INSERT) {
        context.stateFlags.insert = true;
    }
    log("Tree:");
    log(tree.toString());
    return { tree: tree, context: context };
}
// Find all the representations of a thing
function findAlternativeRepresentations(node) {
    var attr = findEveAttribute(node.name);
    var coll = findEveCollection(node.name);
    var ent = findEveEntity(node.name);
    var fxn = stringToFunction(node.name);
    node.representations = {
        collection: coll,
        entity: ent,
        attribute: attr,
        fxn: fxn,
    };
    node.foundReps = true;
}
// Swap the representation of the node with another one
// Clears all attributes related to the old rep, and adds a new one
function changeRepresentation(node, rep, context) {
    // Clear the node
    node.found = false;
    if (node.collection !== undefined) {
        node.collection = undefined;
        node.properties.splice(node.properties.indexOf(Properties.COLLECTION), 1);
    }
    else if (node.entity !== undefined) {
        node.entity = undefined;
        node.properties.splice(node.properties.indexOf(Properties.ENTITY), 1);
    }
    else if (node.attribute !== undefined) {
        node.attribute = undefined;
        node.properties.splice(node.properties.indexOf(Properties.ATTRIBUTE), 1);
    }
    else if (node.fxn !== undefined) {
        node.fxn = undefined;
        node.properties.splice(node.properties.indexOf(Properties.FUNCTION), 1);
    }
    // Switch the representation
    if (rep === Properties.COLLECTION) {
        if (node.representations.collection) {
            findCollection(node, context);
            return true;
        }
    }
    else if (rep === Properties.ENTITY) {
        if (node.representations.entity) {
            findEntity(node, context);
            return true;
        }
    }
    else if (rep === Properties.ATTRIBUTE) {
        if (node.representations.attribute) {
            findAttribute(node, context);
            return true;
        }
    }
    else if (rep === Properties.FUNCTION) {
        if (node.representations.fxn) {
            findFunction(node, context);
            return true;
        }
    }
    return false;
}
// Adds a node to an argument. If adding the node completes a select,
// a new node will be returned
function addNodeToFunction(node, fxnNode, context) {
    log("Matching \"" + node.name + "\" with function \"" + fxnNode.name + "\"");
    // Find the correct arg
    var arg;
    if (node.hasProperty(Properties.ENTITY)) {
        arg = fxnNode.children.filter(function (c) { return c.hasProperty(Properties.ENTITY) && !c.found; }).shift();
    }
    else if (node.hasProperty(Properties.COLLECTION)) {
        arg = fxnNode.children.filter(function (c) { return c.hasProperty(Properties.COLLECTION) && !c.found; }).shift();
    }
    else if (node.hasProperty(Properties.ATTRIBUTE)) {
        arg = fxnNode.children.filter(function (c) { return c.hasProperty(Properties.ATTRIBUTE) && !c.found; }).shift();
    }
    else if (node.hasProperty(Properties.FUNCTION)) {
        arg = fxnNode.children.filter(function (c) { return c.hasProperty(Properties.FUNCTION) && !c.found; }).shift();
    }
    else {
        arg = fxnNode.children.filter(function (c) { return c.hasProperty(Properties.ROOT); }).shift();
    }
    if (fxnNode.fxn.type === FunctionTypes.GROUP && arg.name === "collection") {
        context.groupings.push(node);
    }
    // Add the node to the arg
    if (arg !== undefined) {
        if (fxnNode.fxn.type === FunctionTypes.SELECT) {
            var root = findParentWithProperty(fxnNode, Properties.ROOT);
            removeBranch(fxnNode);
            context.arguments.splice(context.arguments.indexOf(node.children[0]), 1);
            context.fxns.splice(context.fxns.indexOf(fxnNode), 1);
            node.properties.push(Properties.POSSESSIVE);
            root.addChild(node);
        }
        else {
            arg.addChild(node);
        }
        arg.found = true;
        return true;
    }
    else {
        return false;
    }
}
function cloneEntity(entity) {
    var clone = {
        id: entity.id,
        displayName: entity.displayName,
        node: entity.node,
        variable: entity.variable,
        project: entity.project,
    };
    return clone;
}
function cloneCollection(collection) {
    var clone = {
        id: collection.id,
        displayName: collection.displayName,
        node: collection.node,
        variable: collection.variable,
        project: collection.project,
    };
    return clone;
}
// Returns the entity with the given display name.
// If the entity is not found, returns undefined
// Two error modes here: 
// 1) the name is not found in "display name"
// 2) the name is found in "display name" but not found in "entity"
// can 2) ever happen?
// Returns the collection with the given display name.
function findEveEntity(search) {
    log("Searching for entity: " + search);
    var foundEntity;
    var name;
    // Try to find by display name first
    var display = app_1.eve.findOne("index name", { name: search });
    if (display !== undefined) {
        foundEntity = app_1.eve.findOne("entity", { entity: display.id });
        name = search;
    }
    else {
        foundEntity = app_1.eve.findOne("entity", { entity: search });
    }
    // Build the entity
    if (foundEntity !== undefined) {
        if (name === undefined) {
            display = app_1.eve.findOne("display name", { id: search });
            name = display.name;
        }
        var entity = {
            id: foundEntity.entity,
            displayName: name,
            variable: name.replace(/ /g, ''),
            project: true,
        };
        log(" Found: " + entity.id);
        return entity;
    }
    else {
        log(" Not found: " + search);
        return undefined;
    }
}
// Returns the collection with the given display name.
function findEveCollection(search) {
    log("Searching for collection: " + search);
    var foundCollection;
    var name;
    // Try to find by display name first
    var display = app_1.eve.findOne("index name", { name: search });
    if (display !== undefined) {
        foundCollection = app_1.eve.findOne("collection", { collection: display.id });
        name = search;
    }
    else {
        foundCollection = app_1.eve.findOne("collection", { collection: search });
    }
    // Build the collection
    if (foundCollection !== undefined) {
        if (name === undefined) {
            display = app_1.eve.findOne("display name", { id: search });
            name = display.name;
        }
        var collection = {
            id: foundCollection.collection,
            displayName: name,
            variable: name.replace(/ /g, ''),
            project: true,
        };
        log(" Found: " + collection.id);
        return collection;
    }
    else {
        log(" Not found: " + search);
        return undefined;
    }
}
// Returns the attribute with the given display name attached to the given entity
// If the entity does not have that attribute, or the entity does not exist, returns undefined
function findEveAttribute(name) {
    log("Searching for attribute: " + name);
    var foundAttribute = app_1.eve.findOne("entity eavs", { attribute: name });
    if (foundAttribute !== undefined) {
        var attribute = {
            id: foundAttribute.attribute,
            displayName: name,
            variable: name.replace(/ /g, ''),
            project: true,
        };
        log(" Found: " + name);
        log(attribute);
        return attribute;
    }
    log(" Not found: " + name);
    return undefined;
}
var RelationshipTypes;
(function (RelationshipTypes) {
    RelationshipTypes[RelationshipTypes["NONE"] = 0] = "NONE";
    RelationshipTypes[RelationshipTypes["DIRECT"] = 1] = "DIRECT";
    RelationshipTypes[RelationshipTypes["ONEHOP"] = 2] = "ONEHOP";
    RelationshipTypes[RelationshipTypes["TWOHOP"] = 3] = "TWOHOP";
    RelationshipTypes[RelationshipTypes["INTERSECTION"] = 4] = "INTERSECTION";
})(RelationshipTypes || (RelationshipTypes = {}));
function findRelationship(nodeA, nodeB, context) {
    var relationship = { type: RelationshipTypes.NONE };
    if ((nodeA === nodeB) ||
        (context.stateFlags.insert) ||
        (nodeA.hasProperty(Properties.QUANTITY) || nodeB.hasProperty(Properties.QUANTITY))) {
        return relationship;
    }
    log("Finding relationship between \"" + nodeA.name + "\" and \"" + nodeB.name + "\"");
    // Sort the nodes in order
    // 1) Collection 
    // 2) Entity 
    // 3) Attribute
    nodeA.properties.sort(function (a, b) { return a - b; });
    nodeB.properties.sort(function (a, b) { return a - b; });
    var nodes = [nodeA, nodeB].sort(function (a, b) { return a.properties[0] - b.properties[0]; });
    nodeA = nodes[0];
    nodeB = nodes[1];
    // Find the proper relationship
    if (nodeA.hasProperty(Properties.ENTITY) && nodeB.hasProperty(Properties.ATTRIBUTE)) {
        relationship = findEntToAttrRelationship(nodeA, nodeB, context);
    }
    else if (nodeA.hasProperty(Properties.COLLECTION) && nodeB.hasProperty(Properties.ATTRIBUTE)) {
        relationship = findCollToAttrRelationship(nodeA, nodeB, context);
    }
    else if (nodeA.hasProperty(Properties.COLLECTION) && nodeB.hasProperty(Properties.COLLECTION)) {
        relationship = findCollToCollRelationship(nodeA, nodeB, context);
    }
    // Add relationships to the nodes and context
    if (relationship.type !== RelationshipTypes.NONE) {
        nodeA.relationships.push(relationship);
        nodeB.relationships.push(relationship);
        context.relationships.push(relationship);
    }
    else {
        var repChanged = false;
        // If one node is possessive, it suggests the other should be represented as an attribute of the first
        if (nodeA.hasProperty(Properties.POSSESSIVE) && !nodeB.hasProperty(Properties.ATTRIBUTE) && nodeB.representations.attribute !== undefined) {
            repChanged = changeRepresentation(nodeB, Properties.ATTRIBUTE, context);
        }
        if (repChanged) {
            relationship = findRelationship(nodeA, nodeB, context);
        }
    }
    return relationship;
    /*
    // If one node is an entity and the other is a collection
    } else if (nodeA.hasProperty(Properties.COLLECTION) && nodeB.hasProperty(Properties.ENTITY)) {
      relationship = findCollectionToEntRelationship(nodeA.collection, nodeB.entity);
    } else if (nodeB.hasProperty(Properties.COLLECTION) && nodeA.hasProperty(Properties.ENTITY)) {
      relationship = findCollectionToEntRelationship(nodeB.collection, nodeA.entity);
    }*/
}
// e.g. "meetings john was in"
function findCollToEntRelationship(coll, ent) {
    log("Finding Coll -> Ent relationship between \"" + coll.displayName + "\" and \"" + ent.displayName + "\"...");
    /*if (coll === "collections") {
      if (eve.findOne("collection entities", { entity: ent.id })) {
        return { type: RelationshipTypes.DIRECT };
      }
    }*/
    if (app_1.eve.findOne("collection entities", { collection: coll.id, entity: ent.id })) {
        log("Found Direct relationship");
        return { type: RelationshipTypes.DIRECT };
    }
    var relationship = app_1.eve.query("")
        .select("collection entities", { collection: coll.id }, "collection")
        .select("directionless links", { entity: ["collection", "entity"], link: ent.id }, "links")
        .exec();
    if (relationship.unprojected.length) {
        log("Found One-Hop Relationship");
        return { type: RelationshipTypes.ONEHOP };
    } /*
    // e.g. events with chris granger (events -> meetings -> chris granger)
    let relationships2 = eve.query(``)
      .select("collection entities", { collection: coll }, "collection")
      .select("directionless links", { entity: ["collection", "entity"] }, "links")
      .select("directionless links", { entity: ["links", "link"], link: ent }, "links2")
      .exec();
    if (relationships2.unprojected.length) {
      let entities = extractFromUnprojected(relationships2.unprojected, 1, 3);
      return { type: RelationshipTypes.TWOHOP };
    }*/
    log("  No relationship found");
    return { type: RelationshipTypes.NONE };
}
function findEntToAttrRelationship(ent, attr, context) {
    log("Finding Ent -> Attr relationship between \"" + ent.name + "\" and \"" + attr.name + "\"...");
    // Check for a direct relationship
    // e.g. "Josh's age"
    var eveRelationship = app_1.eve.findOne("entity eavs", { entity: ent.entity.id, attribute: attr.attribute.id });
    if (eveRelationship) {
        log("  Found a direct relationship.");
        var attribute = attr.attribute;
        var varName = (ent.name + "|" + attr.name).replace(/ /g, '');
        attribute.variable = varName;
        attribute.refs = [ent];
        attribute.project = true;
        ent.entity.handled = true;
        return { type: RelationshipTypes.DIRECT, nodes: [ent, attr], implicitNodes: [] };
    }
    // Check for a one-hop relationship
    // e.g. "Salaries in engineering"
    eveRelationship = app_1.eve.query("")
        .select("directionless links", { entity: ent.entity.id }, "links")
        .select("entity eavs", { entity: ["links", "link"], attribute: attr.attribute.id }, "eav")
        .exec();
    if (eveRelationship.unprojected.length) {
        log("Found One-Hop Relationship");
        log(eveRelationship);
        // Fill in the attribute
        var entities = extractFromUnprojected(eveRelationship.unprojected, 0, 2, "link");
        var collections = findCommonCollections(entities);
        var collLinkID;
        if (collections.length > 0) {
            // @HACK Choose the correct collection in a smart way. 
            // Largest collection other than entity or testdata?
            collLinkID = collections[0];
        }
        var foundCollection = findEveCollection(collLinkID);
        var linkToken = newToken(foundCollection.displayName);
        var linkCollection = newNode(linkToken);
        findCollection(linkCollection, context);
        var attribute = attr.attribute;
        var varName = (linkCollection.name + "|" + attr.name).replace(/ /g, '');
        attribute.variable = varName;
        attribute.refs = [linkCollection];
        // Find the one-hop link
        var getAttr = app_1.eve.query("")
            .select("directionless links", { entity: ent.entity.id }, "links")
            .select("entity eavs", { entity: ["links", "link"], value: ent.entity.id }, "eav")
            .exec();
        var attributes = extractFromUnprojected(getAttr.unprojected, 1, 2, "attribute");
        attributes = attributes.filter(onlyUnique);
        var attrLinkID;
        if (attributes.length > 0) {
            attrLinkID = attributes[0];
        }
        // Build a link attribute node
        var newName = attrLinkID;
        var nToken = newToken(newName);
        var nNode = newNode(nToken);
        var nAttribute = {
            id: attrLinkID,
            refs: [linkCollection],
            node: nNode,
            displayName: attrLinkID,
            variable: "\"" + ent.entity.id + "\"",
            project: false,
        };
        nNode.attribute = nAttribute;
        nNode.properties.push(Properties.ATTRIBUTE);
        nNode.found = true;
        // Project what we need to
        attribute.project = true;
        ent.entity.project = false;
        ent.entity.handled = true;
        var relationship = { type: RelationshipTypes.ONEHOP, nodes: [ent, attr], implicitNodes: [nNode] };
        nNode.relationships.push(relationship);
        return relationship;
    }
    /*
    let relationships2 = eve.query(``)
      .select("directionless links", { entity: entity.id }, "links")
      .select("directionless links", { entity: ["links", "link"] }, "links2")
      .select("entity eavs", { entity: ["links2", "link"], attribute: attr }, "eav")
      .exec();
    if (relationships2.unprojected.length) {
      let entities = extractFromUnprojected(relationships2.unprojected, 0, 3);
      let entities2 = extractFromUnprojected(relationships2.unprojected, 1, 3);
      //return { distance: 2, type: RelationshipTypes.ENTITY_ATTRIBUTE, nodes: [findCommonCollections(entities), findCommonCollections(entities2)] };
    }*/
    log("  No relationship found.");
    return { type: RelationshipTypes.NONE };
}
function findCollToCollRelationship(collA, collB, context) {
    log("Finding Coll -> Coll relationship between \"" + collA.collection.displayName + "\" and \"" + collB.collection.displayName + "\"...");
    // are there things in both sets?
    var intersection = app_1.eve.query(collA.collection.displayName + "->" + collB.collection.displayName)
        .select("collection entities", { collection: collA.collection.id }, "collA")
        .select("collection entities", { collection: collB.collection.id, entity: ["collA", "entity"] }, "collB")
        .exec();
    // is there a relationship between things in both sets
    var relationships = app_1.eve.query("relationships between " + collA.collection.displayName + " and " + collB.collection.displayName)
        .select("collection entities", { collection: collA.collection.id }, "collA")
        .select("directionless links", { entity: ["collA", "entity"] }, "links")
        .select("collection entities", { collection: collB.collection.id, entity: ["links", "link"] }, "collB")
        .group([["links", "link"]])
        .aggregate("count", {}, "count")
        .project({ type: ["links", "link"], count: ["count", "count"] })
        .exec();
    var maxRel = { count: 0 };
    for (var _i = 0, _a = relationships.results; _i < _a.length; _i++) {
        var result = _a[_i];
        if (result.count > maxRel.count)
            maxRel = result;
    }
    // we divide by two because unprojected results pack rows next to eachother
    // and we have two selects.
    var intersectionSize = intersection.unprojected.length / 2;
    if (maxRel.count > intersectionSize) {
        // @TODO
        log("  No relationship found");
        return { type: RelationshipTypes.NONE };
    }
    else if (intersectionSize > 0) {
        log(" Found Intersection relationship.");
        collA.collection.variable = collB.collection.variable;
        collB.collection.project = true;
        collA.collection.project = false;
        return { type: RelationshipTypes.INTERSECTION, nodes: [collA, collB] };
    }
    else if (maxRel.count === 0 && intersectionSize === 0) {
        log("  No relationship found");
        return { type: RelationshipTypes.NONE };
    }
    else {
        // @TODO
        log("  No relationship found");
        return { type: RelationshipTypes.NONE };
    }
}
exports.findCollToCollRelationship = findCollToCollRelationship;
function findCollToAttrRelationship(coll, attr, context) {
    // Finds a direct relationship between collection and attribute
    // e.g. "pets' lengths"" => pet -> length
    log("Finding Coll -> Attr relationship between \"" + coll.name + "\" and \"" + attr.name + "\"...");
    var eveRelationship = app_1.eve.query("")
        .select("collection entities", { collection: coll.collection.id }, "collection")
        .select("entity eavs", { entity: ["collection", "entity"], attribute: attr.attribute.id }, "eav")
        .exec();
    if (eveRelationship.unprojected.length > 0) {
        log("  Found Direct Relationship");
        // Build an attribute node
        var attribute = attr.attribute;
        var varName = (coll.name + "|" + attr.name).replace(/ /g, '');
        attribute.variable = varName;
        attribute.refs = [coll];
        attribute.project = true;
        return { type: RelationshipTypes.DIRECT, nodes: [coll, attr], implicitNodes: [] };
    }
    // Finds a one hop relationship
    // e.g. "department salaries" => department -> employee -> salary
    eveRelationship = app_1.eve.query("")
        .select("collection entities", { collection: coll.collection.id }, "collection")
        .select("directionless links", { entity: ["collection", "entity"] }, "links")
        .select("entity eavs", { entity: ["links", "link"], attribute: attr.attribute.id }, "eav")
        .exec();
    if (eveRelationship.unprojected.length > 0) {
        log("  Found One-Hop Relationship");
        log(eveRelationship);
        // Find the one-hop link
        var entities = extractFromUnprojected(eveRelationship.unprojected, 1, 3, "link");
        var collections = findCommonCollections(entities);
        var linkID;
        if (collections.length > 0) {
            // @HACK Choose the correct collection in a smart way. 
            // Largest collection other than entity or testdata?
            linkID = collections[0];
        }
        // Fill in the attribute
        var foundCollection = findEveCollection(linkID);
        var linkToken = newToken(foundCollection.displayName);
        var linkCollection = newNode(linkToken);
        findCollection(linkCollection, context);
        var attribute = attr.attribute;
        var varName = (linkCollection.name + "|" + attr.name).replace(/ /g, '');
        attribute.variable = varName;
        attribute.refs = [linkCollection];
        attribute.project = true;
        // Build a link attribute node
        var newName = coll.collection.variable;
        var nToken = newToken(newName);
        var nNode = newNode(nToken);
        var nAttribute = {
            id: coll.collection.displayName,
            refs: [linkCollection],
            node: nNode,
            displayName: newName,
            variable: newName,
            project: false,
        };
        nNode.attribute = nAttribute;
        nNode.properties.push(Properties.ATTRIBUTE);
        nNode.found = true;
        // Project what we need to
        linkCollection.collection.project = true;
        coll.collection.project = true;
        var relationship = { type: RelationshipTypes.ONEHOP, nodes: [coll, attr], implicitNodes: [nNode] };
        nNode.relationships.push(relationship);
        linkCollection.relationships.push(relationship);
        return relationship;
    }
    /*
    // Not sure if this one works... using the entity table, a 2 hop link can
    // be found almost anywhere, yielding results like
    // e.g. "Pets heights" => pets -> snake -> entity -> corey -> height
     relationship = eve.query(``)
      .select("collection entities", { collection: coll.id }, "collection")
      .select("directionless links", { entity: ["collection", "entity"] }, "links")
      .select("directionless links", { entity: ["links", "link"] }, "links2")
     .select("entity eavs", { entity: ["links2", "link"], attribute: attr }, "eav")
      .exec();
    if (relationship.unprojected.length > 0) {
      return true;
    }*/
    log("  No relationship found");
    return { type: RelationshipTypes.NONE };
}
// Extracts entities from unprojected results
function extractFromUnprojected(coll, ix, size, field) {
    var results = [];
    for (var i = 0, len = coll.length; i < len; i += size) {
        results.push(coll[i + ix][field]);
    }
    return results;
}
// Find collections that entities have in common
function findCommonCollections(entities) {
    var intersection = entityTocollectionsArray(entities[0]);
    intersection.sort();
    for (var _i = 0, _a = entities.slice(1); _i < _a.length; _i++) {
        var entId = _a[_i];
        var cur = entityTocollectionsArray(entId);
        cur.sort();
        arrayIntersect(intersection, cur);
    }
    intersection.sort(function (a, b) {
        return app_1.eve.findOne("collection", { collection: a })["count"] - app_1.eve.findOne("collection", { collection: b })["count"];
    });
    return intersection;
}
function entityTocollectionsArray(entity) {
    var entities = app_1.eve.find("collection entities", { entity: entity });
    return entities.map(function (a) { return a["collection"]; });
}
function findCollection(node, context) {
    var collection;
    collection = findEveCollection(node.name);
    if (collection !== undefined) {
        context.found.push(node);
        collection.node = node;
        node.collection = collection;
        node.representations.collection = collection;
        node.type = NodeTypes.COLLECTION;
        node.found = true;
        node.properties.push(Properties.COLLECTION);
        return true;
    }
    return false;
}
function findEntity(node, context) {
    var entity;
    entity = findEveEntity(node.name);
    if (entity !== undefined) {
        context.found.push(node);
        entity.node = node;
        node.entity = entity;
        node.representations.entity = entity;
        node.type = NodeTypes.ENTITY;
        node.found = true;
        node.properties.push(Properties.ENTITY);
        return true;
    }
    return false;
}
function findAttribute(node, context) {
    if (node.name === "is a") {
        return false;
    }
    var attribute;
    attribute = findEveAttribute(node.name);
    if (attribute !== undefined) {
        context.found.push(node);
        attribute.node = node;
        node.attribute = attribute;
        node.representations.attribute = attribute;
        node.type = NodeTypes.ATTRIBUTE;
        node.found = true;
        node.properties.push(Properties.ATTRIBUTE);
        return true;
    }
    return false;
}
function addFieldsToProject(projectFields, fields) {
    var field;
    for (var _i = 0; _i < fields.length; _i++) {
        field = fields[_i];
        var matchingFields = projectFields.filter(function (f) { return f.name === field.name; });
        if (matchingFields.length === 0) {
            projectFields.push(field);
        }
    }
}
function negateTerm(term) {
    if (term.table === "entity eavs" && term.fields[2] !== undefined && term.fields[2].name === "value") {
        term.fields.splice(2, 1);
    }
    var negate = newQuery([term]);
    negate.type = "negate";
    return negate;
}
function newQuery(terms, subqueries, projects) {
    if (terms === undefined) {
        terms = [];
    }
    if (subqueries === undefined) {
        subqueries = [];
    }
    if (projects === undefined) {
        projects = [];
    }
    // Dedupe terms
    var termStrings = terms.map(termToString);
    var uniqueTerms = termStrings.map(function (value, index, self) {
        return self.indexOf(value) === index;
    });
    terms = terms.filter(function (term, index) { return uniqueTerms[index]; });
    var query = {
        type: "query",
        terms: terms,
        subqueries: subqueries,
        projects: projects,
        toString: queryToString,
    };
    function queryToString(depth) {
        if (query.terms.length === 0 && query.projects.length === 0) {
            return "";
        }
        if (depth === undefined) {
            depth = 0;
        }
        var indent = Array(depth + 1).join("\t");
        var queryString = indent + "(";
        // Map each term/subquery/project to a string
        var typeString = query.type;
        var termString = query.terms.map(function (term) { return termToString(term, depth + 1); }).join("\n");
        var subqueriesString = query.subqueries.map(function (query) { return query.toString(depth + 1); }).join("\n");
        var projectsString = query.projects.map(function (term) { return termToString(term, depth + 1); }).join("\n");
        // Now compose the query string
        queryString += typeString;
        queryString += termString === "" ? "" : "\n" + termString;
        queryString += subqueriesString === "" ? "" : "\n" + subqueriesString;
        queryString += projectsString === "" ? "" : "\n" + projectsString;
        // Close out the query
        queryString += "\n" + indent + ")";
        return queryString;
    }
    function termToString(term, depth) {
        if (depth === undefined) {
            depth = 0;
        }
        var indent = Array(depth + 1).join("\t");
        var termString = indent + "(";
        termString += term.type + " ";
        termString += "" + (term.table === undefined ? "" : "\"" + term.table + "\" ");
        termString += term.fields.map(function (field) { return (":" + field.name + " " + (field.variable ? field.value : "\"" + field.value + "\"")); }).join(" ");
        termString += ")";
        return termString;
    }
    return query;
}
exports.newQuery = newQuery;
function formQuery(node) {
    var query = newQuery();
    var projectFields = [];
    //--------------------------
    // Handle the children nodes
    //--------------------------
    var childQueries = node.children.map(formQuery);
    // Subsume child queries
    var combinedProjectFields = [];
    for (var _i = 0; _i < childQueries.length; _i++) {
        var cQuery = childQueries[_i];
        query.terms = query.terms.concat(cQuery.terms);
        query.subqueries = query.subqueries.concat(cQuery.subqueries);
        // Combine unnamed projects
        for (var _a = 0, _b = cQuery.projects; _a < _b.length; _a++) {
            var project = _b[_a];
            if (project.table === undefined) {
                addFieldsToProject(combinedProjectFields, project.fields);
            }
        }
    }
    if (combinedProjectFields.length > 0) {
        projectFields = combinedProjectFields;
    }
    // Sort terms
    query.terms = query.terms.sort(function (a, b) {
        var aRank = setRank(a.table);
        var bRank = setRank(b.table);
        function setRank(table) {
            if (table === "entity eavs") {
                return 1;
            }
            else if (table === "is a attributes") {
                return 2;
            }
            else {
                return 3;
            }
        }
        return aRank - bRank;
    });
    //-------------------------
    // Handle the current node
    //-------------------------
    // Just return at the root
    if (node.hasProperty(Properties.ROOT) || node.hasProperty(Properties.ARGUMENT)) {
        if (projectFields.length > 0) {
            var project = {
                type: "project!",
                fields: projectFields,
            };
            query.projects.push(project);
        }
        return query;
    }
    // Handle functions -------------------------------
    if (node.hasProperty(Properties.FUNCTION) &&
        node.fxn.type === FunctionTypes.NEGATE) {
        log("Building negate term for: " + node.name);
        var negatedTerm = query.terms.pop();
        var negatedQuery = negateTerm(negatedTerm);
        query.subqueries.push(negatedQuery);
        projectFields = [];
    }
    if (node.hasProperty(Properties.FUNCTION) && (node.fxn.type === FunctionTypes.AGGREGATE ||
        node.fxn.type === FunctionTypes.CALCULATE ||
        node.fxn.type === FunctionTypes.FILTER)) {
        // Collection all input and output nodes which were found
        var allArgsFound = node.children.every(function (child) { return child.found; });
        // If we have the right number of arguments, proceed
        // @TODO surface an error if the arguments are wrong
        var output;
        if (allArgsFound) {
            log("Building function term for: " + node.name);
            var args = node.children.filter(function (child) { return child.hasProperty(Properties.ARGUMENT); }).map(function (arg) { return arg.children[0]; });
            var fields = args.map(function (arg, i) {
                return { name: node.fxn.fields[i].name,
                    value: arg.attribute.variable,
                    variable: true };
            });
            var term = {
                type: "select",
                table: node.fxn.name,
                fields: fields,
            };
            query.terms.push(term);
            // project output if necessary
            if (node.fxn.project === true) {
                projectFields = args.filter(function (arg) { return arg.parent.hasProperty(Properties.OUTPUT); })
                    .map(function (arg) {
                    return { name: node.fxn.name,
                        value: arg.attribute.variable,
                        variable: true };
                });
                query.projects = []; // Clears all previous projects
            }
        }
    }
    if (node.hasProperty(Properties.FUNCTION) && (node.fxn.type === FunctionTypes.GROUP)) {
        var allArgsFound = node.children.every(function (child) { return child.found; });
        if (allArgsFound) {
            log("Building function term for: " + node.name);
            var groupNode = node.children[1].children[0];
            groupNode.collection.handled = false;
            var subquery = query;
            var query2 = formQuery(groupNode);
            query = newQuery();
            query.subqueries.push(subquery);
            query.terms = query.terms.concat(query2.terms);
        }
    }
    // Handle attributes -------------------------------
    if (node.hasProperty(Properties.ATTRIBUTE) && !node.attribute.handled) {
        log("Building attribute term for: " + node.name);
        var fields = [];
        var attr = node.attribute;
        if (attr.refs !== undefined) {
            for (var _c = 0, _d = attr.refs; _c < _d.length; _c++) {
                var ref = _d[_c];
                var entityVar = ref.entity !== undefined ? ref.entity.id : ref.collection.variable;
                var fieldVar = ref.entity !== undefined ? false : true;
                if (fields.length === 0) {
                    var entityField = {
                        name: "entity",
                        value: entityVar,
                        variable: fieldVar,
                    };
                    fields.push(entityField);
                }
                // Build a query for each ref and merge it with the current query
                var refQuery = formQuery(ref);
                query.terms = query.terms.concat(refQuery.terms);
                if (refQuery.projects.length > 0) {
                    addFieldsToProject(projectFields, refQuery.projects[0].fields);
                }
            }
        }
        var attrField = {
            name: "attribute",
            value: attr.id,
            variable: false
        };
        fields.push(attrField);
        var valueField = {
            name: "value",
            value: attr.variable,
            variable: true
        };
        fields.push(valueField);
        var term = {
            type: "select",
            table: "entity eavs",
            fields: fields,
        };
        query.terms.push(term);
        // project if necessary
        if (node.attribute.project) {
            var projectAttribute = {
                name: attr.displayName,
                value: attr.variable,
                variable: true
            };
            addFieldsToProject(projectFields, [projectAttribute]);
        }
        node.attribute.handled = true;
    }
    // Handle collections -------------------------------
    if (node.hasProperty(Properties.COLLECTION) && !node.collection.handled) {
        log("Building collection term for: " + node.name);
        var entityField = {
            name: "entity",
            value: node.collection.variable,
            variable: true
        };
        var collectionField = {
            name: "collection",
            value: node.collection.id,
            variable: false
        };
        var term = {
            type: "select",
            table: "is a attributes",
            fields: [entityField, collectionField],
        };
        query.terms.push(term);
        // project if necessary
        if (node.collection.project) {
            collectionField = {
                name: node.collection.variable,
                value: node.collection.variable,
                variable: true
            };
            addFieldsToProject(projectFields, [collectionField]);
        }
        node.collection.handled = true;
    }
    // Handle entities -------------------------------
    if (node.hasProperty(Properties.ENTITY) && !node.entity.handled) {
        log("Building entity term for: " + node.name);
        var entity = node.entity;
        var entityField = {
            name: "entity",
            value: entity.id,
            variable: false,
        };
        var term = {
            type: "select",
            table: "entity eavs",
            fields: [entityField],
        };
        query.terms.push(term);
        // project if necessary
        if (entity.project === true) {
            var entityField_1 = {
                name: entity.displayName.replace(/ /g, ''),
                value: entity.id,
                variable: false
            };
            addFieldsToProject(projectFields, [entityField_1]);
        }
        node.entity.handled = true;
    }
    // Project something if necessary       
    if (projectFields.length > 0) {
        var project = {
            type: "project!",
            fields: projectFields,
        };
        query.projects.push(project);
    }
    return query;
}
// ----------------------------------------------------------------------------
// Debug utility functions
// ---------------------------------------------------------------------------- 
var divider = "--------------------------------------------------------------------------------";
exports.debug = false;
function log(x) {
    if (exports.debug) {
        console.log(x);
    }
}
function tokenToString(token, s1, s2, s3, s4, s5) {
    var properties = "(" + token.properties.map(function (property) { return Properties[property]; }).join("|") + ")";
    properties = properties.length === 2 ? "" : properties;
    var tokenSpan = token.start === undefined ? " " : " [" + token.start + "-" + token.end + "] ";
    var spacer1 = Array(s1 - ("" + token.ix).length + 1).join(" ");
    var spacer2 = Array(s2 - ("" + token.originalWord).length + 1).join(" ");
    var spacer3 = Array(s3 - ("" + token.normalizedWord).length + 1).join(" ");
    var spacer4 = Array(s4 - ("" + MajorPartsOfSpeech[getMajorPOS(token.POS)]).length + 1).join(" ");
    var spacer5 = Array(s5 - ("" + MinorPartsOfSpeech[token.POS]).length + 1).join(" ");
    var tokenString = token.ix + ":" + spacer1 + " " + token.originalWord + spacer2 + " | " + token.normalizedWord + spacer3 + " | " + MajorPartsOfSpeech[getMajorPOS(token.POS)] + spacer4 + " | " + MinorPartsOfSpeech[token.POS] + spacer5 + " | " + properties;
    return tokenString;
}
function tokenArrayToString(tokens) {
    var s1 = ("" + tokens[tokens.length - 1].ix).length;
    var s2 = tokens.map(function (token) { return token.originalWord.length; }).reduce(function (a, b) {
        if (b > a) {
            return b;
        }
        else {
            return a;
        }
    });
    var s3 = tokens.map(function (token) { return token.normalizedWord.length; }).reduce(function (a, b) {
        if (b > a) {
            return b;
        }
        else {
            return a;
        }
    });
    var s4 = tokens.map(function (token) { return ("" + MajorPartsOfSpeech[getMajorPOS(token.POS)]).length; }).reduce(function (a, b) {
        if (b > a) {
            return b;
        }
        else {
            return a;
        }
    });
    var s5 = tokens.map(function (token) { return ("" + MinorPartsOfSpeech[token.POS]).length; }).reduce(function (a, b) {
        if (b > a) {
            return b;
        }
        else {
            return a;
        }
    });
    var tokenArrayString = tokens.map(function (token) { return tokenToString(token, s1, s2, s3, s4, s5); }).join("\n");
    return divider + "\n" + tokenArrayString + "\n" + divider;
}
exports.tokenArrayToString = tokenArrayToString;
// ----------------------------------------------------------------------------
// Utility functions
// ----------------------------------------------------------------------------
function flattenNestedArray(nestedArray) {
    var flattened = [].concat.apply([], nestedArray);
    return flattened;
}
function onlyUnique(value, index, self) {
    return self.indexOf(value) === index;
}
function arrayIntersect(a, b) {
    var ai = 0;
    var bi = 0;
    var result = [];
    while (ai < a.length && bi < b.length) {
        if (a[ai] < b[bi])
            ai++;
        else if (a[ai] > b[bi])
            bi++;
        else {
            result.push(a[ai]);
            ai++;
            bi++;
        }
    }
    return result;
}
function isNumeric(n) {
    return !isNaN(parseFloat(n)) && isFinite(n);
}
function allFound(node) {
    var cFound = node.children.map(allFound).every(function (c) { return c; });
    if (cFound && node.found) {
        return true;
    }
    else {
        return false;
    }
}
window["NLQP"] = exports;

},{"./app":9}],9:[function(require,module,exports){
/// <reference path="microReact.ts" />
/// <reference path="../vendor/marked.d.ts" />
var microReact = require("./microReact");
var runtime = require("./runtime");
var uiRenderer_1 = require("./uiRenderer");
var utils_1 = require("./utils");
exports.syncedTables = ["sourced eav", "view", "action", "action source", "action mapping", "action mapping constant", "action mapping sorted", "action mapping limit"];
exports.eveLocalStorageKey = "eve";
//---------------------------------------------------------
// Renderer
//---------------------------------------------------------
var perfStats;
var perfStatsUi;
var updateStat = 0;
function initRenderer() {
    exports.renderer = new microReact.Renderer();
    exports.uiRenderer = new uiRenderer_1.UIRenderer(exports.eve);
    document.body.appendChild(exports.renderer.content);
    window.addEventListener("resize", render);
    perfStatsUi = document.createElement("div");
    perfStatsUi.id = "perfStats";
    document.body.appendChild(perfStatsUi);
}
if (utils_1.ENV === "browser")
    var performance = window["performance"] || { now: function () { return (new Date()).getTime(); } };
exports.renderRoots = {};
function render() {
    if (!exports.renderer || exports.renderer.queued)
        return;
    exports.renderer.queued = true;
    requestAnimationFrame(function () {
        var stats = {};
        var start = performance.now();
        var trees = [];
        for (var root in exports.renderRoots) {
            trees.push(exports.renderRoots[root]());
        }
        stats.root = (performance.now() - start).toFixed(2);
        if (+stats.root > 10)
            console.info("Slow root: " + stats.root);
        start = performance.now();
        var dynamicUI = exports.eve.find("system ui").map(function (ui) { return ui["template"]; });
        if (utils_1.DEBUG && utils_1.DEBUG.UI_COMPILE) {
            console.info("compiling", dynamicUI);
            console.info("*", exports.uiRenderer.compile(dynamicUI));
        }
        trees.push.apply(trees, exports.uiRenderer.compile(dynamicUI));
        stats.uiCompile = (performance.now() - start).toFixed(2);
        if (+stats.uiCompile > 10)
            console.info("Slow ui compile: " + stats.uiCompile);
        start = performance.now();
        exports.renderer.render(trees);
        stats.render = (performance.now() - start).toFixed(2);
        stats.update = updateStat.toFixed(2);
        var html = "";
        html += "<span>root: " + stats.root + "</span>";
        html += "<span>ui compile: " + stats.uiCompile + "</span>";
        html += "<span>render: " + stats.render + "</span>";
        html += "<span>update: " + stats.update + "</span>";
        perfStatsUi.innerHTML = html;
        perfStats = stats;
        exports.renderer.queued = false;
    });
}
exports.render = render;
var storeQueued = false;
function storeLocally() {
    if (storeQueued)
        return;
    storeQueued = true;
    setTimeout(function () {
        var serialized = exports.eve.serialize(true);
        if (exports.eveLocalStorageKey === "eve") {
            for (var _i = 0; _i < exports.syncedTables.length; _i++) {
                var synced = exports.syncedTables[_i];
                delete serialized[synced];
            }
        }
        delete serialized["provenance"];
        localStorage[exports.eveLocalStorageKey] = JSON.stringify(serialized);
        storeQueued = false;
    }, 1000);
}
//---------------------------------------------------------
// Dispatch
//---------------------------------------------------------
var dispatches = {};
function handle(event, func) {
    if (dispatches[event]) {
        console.error("Overwriting handler for '" + event + "'");
    }
    dispatches[event] = func;
}
exports.handle = handle;
function dispatch(event, info, dispatchInfo) {
    var result = dispatchInfo;
    if (!result) {
        result = exports.eve.diff();
        result.meta.render = true;
        result.meta.store = true;
    }
    result.dispatch = function (event, info) {
        return dispatch(event, info, result);
    };
    result.commit = function () {
        var start = performance.now();
        // result.remove("builtin entity", {entity: "render performance statistics"});
        // result.add("builtin entity", {entity: "render performance statistics", content: `
        // # Render performance statistics ({is a: system})
        // root: {root: ${perfStats.root}}
        // ui compile: {ui compile: ${perfStats.uiCompile}}
        // render: {render: ${perfStats.render}}
        // update: {update: ${perfStats.update}}
        // Horrible hack, disregard this: {perf stats: render performance statistics}
        // `});
        if (!runtime.INCREMENTAL) {
            exports.eve.applyDiff(result);
        }
        else {
            exports.eve.applyDiffIncremental(result);
        }
        if (result.meta.render) {
            render();
        }
        if (result.meta.store) {
            storeLocally();
            if (exports.eveLocalStorageKey === "eve") {
                sendChangeSet(result);
            }
        }
        updateStat = performance.now() - start;
    };
    if (!event)
        return result;
    var func = dispatches[event];
    if (!func) {
        console.error("No dispatches for '" + event + "' with " + JSON.stringify(info));
    }
    else {
        func(result, info);
    }
    return result;
}
exports.dispatch = dispatch;
// No-op dispatch to trigger a rerender or start a chain.
handle("rerender", function (changes) {
});
//---------------------------------------------------------
// State
//---------------------------------------------------------
exports.eve = runtime.indexer();
exports.initializers = {};
exports.activeSearches = {};
function init(name, func) {
    exports.initializers[name] = func;
}
exports.init = init;
function executeInitializers() {
    for (var initName in exports.initializers) {
        exports.initializers[initName]();
    }
}
//---------------------------------------------------------
// Websocket
//---------------------------------------------------------
var me = utils_1.uuid();
if (this.localStorage) {
    if (localStorage["me"])
        me = localStorage["me"];
    else
        localStorage["me"] = me;
}
function connectToServer() {
    exports.socket = new WebSocket("ws://" + (window.location.hostname || "localhost") + ":8080");
    exports.socket.onerror = function () {
        console.error("Failed to connect to server, falling back to local storage");
        exports.eveLocalStorageKey = "local-eve";
        executeInitializers();
        render();
    };
    exports.socket.onopen = function () {
        sendServer("connect", me);
    };
    exports.socket.onmessage = function (data) {
        var parsed = JSON.parse(data.data);
        console.log("WS MESSAGE:", parsed);
        if (parsed.kind === "load") {
            // eve.load(parsed.data);
            executeInitializers();
            render();
        }
        else if (parsed.kind === "changeset") {
            var diff = exports.eve.diff();
            diff.tables = parsed.data;
            exports.eve.applyDiff(diff);
            render();
        }
    };
}
function sendServer(messageKind, data) {
    if (!exports.socket)
        return;
    exports.socket.send(JSON.stringify({ kind: messageKind, me: me, time: (new Date).getTime(), data: data }));
}
function sendChangeSet(changeset) {
    if (!exports.socket)
        return;
    var changes = {};
    var send = false;
    for (var _i = 0; _i < exports.syncedTables.length; _i++) {
        var table = exports.syncedTables[_i];
        if (changeset.tables[table]) {
            send = true;
            changes[table] = changeset.tables[table];
        }
    }
    if (send)
        sendServer("changeset", changes);
}
//---------------------------------------------------------
// Go
//---------------------------------------------------------
if (utils_1.ENV === "browser") {
    document.addEventListener("DOMContentLoaded", function (event) {
        initRenderer();
        // connectToServer();
        exports.eveLocalStorageKey = "local-eve";
        executeInitializers();
        render();
    });
}
init("load data", function () {
    var stored = localStorage[exports.eveLocalStorageKey];
    if (stored) {
        exports.eve.load(stored);
    }
});
if (utils_1.ENV === "browser")
    window["app"] = exports;

},{"./microReact":12,"./runtime":15,"./uiRenderer":17,"./utils":19}],10:[function(require,module,exports){
var utils_1 = require("./utils");
var runtime = require("./runtime");
var app = require("./app");
var app_1 = require("./app");
var parser_1 = require("./parser");
var uiRenderer_1 = require("./uiRenderer");
exports.ixer = app_1.eve;
//-----------------------------------------------------------------------------
// Utilities
//-----------------------------------------------------------------------------
// export function UIFromDSL(str:string):UI {
//   function processElem(data:UIElem):UI {
//     let elem = new UI(data.id || uuid());
//     if(data.binding) elem.bind(data.bindingKind === "query" ? parseDSL(data.binding);
//     if(data.embedded) elem.embed(data.embedded);
//     if(data.attributes) elem.attributes(data.attributes);
//     if(data.events) elem.events(data.events);
//     if(data.children) {
//       for(let child of data.children) elem.child(processElem(child));
//     }
//     return elem;
//   }
//   return processElem(parseUI(str));
// }
var BSPhase = (function () {
    function BSPhase(ixer, changeset) {
        if (changeset === void 0) { changeset = ixer.diff(); }
        this.ixer = ixer;
        this.changeset = changeset;
        this._views = {};
        this._viewFields = {};
        this._entities = [];
        this._uis = {};
        this._queries = {};
        this._names = {};
    }
    BSPhase.prototype.viewKind = function (view) {
        return this._views[view];
    };
    BSPhase.prototype.viewFields = function (view) {
        return this._viewFields[view];
    };
    BSPhase.prototype.apply = function (nukeExisting) {
        for (var view in this._views) {
            if (this._views[view] === "table")
                exports.ixer.addTable(view, this._viewFields[view]);
        }
        if (nukeExisting) {
            for (var view in this._views) {
                if (this._views[view] !== "table")
                    this.changeset.merge(runtime.Query.remove(view, this.ixer));
            }
            for (var _i = 0, _a = this._entities; _i < _a.length; _i++) {
                var entity = _a[_i];
                this.changeset.remove("builtin entity", { entity: entity });
            }
            for (var ui in this._uis)
                this.changeset.merge(uiRenderer_1.UI.remove(ui, this.ixer));
        }
        exports.ixer.applyDiff(this.changeset);
    };
    //-----------------------------------------------------------------------------
    // Macros
    //-----------------------------------------------------------------------------
    BSPhase.prototype.addFact = function (table, fact) {
        this.changeset.add(table, fact);
        return this;
    };
    BSPhase.prototype.addEntity = function (entity, name, kinds, attributes, extraContent) {
        entity = utils_1.builtinId(entity);
        this._names[name] = entity;
        this._entities.push(entity);
        this.addFact("display name", { id: entity, name: name });
        var isAs = [];
        for (var _i = 0; _i < kinds.length; _i++) {
            var kind = kinds[_i];
            var sourceId = entity + ",is a," + kind;
            isAs.push("{" + kind + "|rep=link; eav source = " + sourceId + "}");
            var collEntity = utils_1.builtinId(kind);
            this.addFact("display name", { id: collEntity, name: kind });
            this.addFact("sourced eav", { entity: entity, attribute: "is a", value: collEntity, source: sourceId });
        }
        var collectionsText = "";
        if (isAs.length)
            collectionsText = utils_1.titlecase(name) + " is a " + isAs.slice(0, -1).join(", ") + " " + (isAs.length > 1 ? "and" : "") + " " + isAs[isAs.length - 1] + ".";
        var content = (_a = ["\n      ", "\n    "], _a.raw = ["\n      ", "\n    "], utils_1.unpad(6)(_a, collectionsText));
        if (attributes) {
            for (var attr in attributes) {
                var sourceId = entity + "," + attr + "," + attributes[attr];
                var value = this._names[attributes[attr]] || attributes[attr];
                this.addFact("sourced eav", { entity: entity, attribute: attr, value: value, source: sourceId });
            }
        }
        if (extraContent)
            content += "\n" + extraContent;
        var page = entity + "|root";
        this.addFact("page content", { page: page, content: content });
        this.addFact("entity page", { entity: entity, page: page });
        return this;
        var _a;
    };
    BSPhase.prototype.addView = function (view, kind, fields) {
        this._views[view] = kind;
        this._viewFields[view] = fields;
        this.addFact("view", { view: view, kind: kind });
        for (var _i = 0; _i < fields.length; _i++) {
            var field = fields[_i];
            this.addFact("field", { view: view, field: field });
        }
        var entity = view + " view";
        this.addEntity(entity, entity, ["system", kind], undefined, (_a = ["\n      ## Fields\n      ", "\n    "], _a.raw = ["\n      ## Fields\n      ", "\n    "], utils_1.unpad(6)(_a, fields.map(function (field) { return ("* " + field); }).join("\n      "))));
        return this;
        var _a;
    };
    BSPhase.prototype.addTable = function (view, fields) {
        this.addView(view, "table", fields);
        return this;
    };
    BSPhase.prototype.addUnion = function (view, fields, builtin) {
        if (builtin === void 0) { builtin = true; }
        this.addView(view, "union", fields);
        if (builtin) {
            var table = "builtin " + view;
            this.addTable(table, fields);
            this.addUnionMember(view, table);
        }
        return this;
    };
    BSPhase.prototype.addUnionMember = function (union, member, mapping) {
        // apply the natural mapping.
        if (!mapping) {
            if (this.viewKind(union) !== "union")
                throw new Error("Union '" + union + "' must be added before adding members");
            mapping = {};
            for (var _i = 0, _a = this.viewFields(union); _i < _a.length; _i++) {
                var field = _a[_i];
                mapping[field] = field;
            }
        }
        var action = union + " <-- " + member + " <-- " + JSON.stringify(mapping);
        this.addFact("action", { view: union, action: action, kind: "union", ix: 0 })
            .addFact("action source", { action: action, "source view": member });
        for (var field in mapping) {
            var mapped = mapping[field];
            if (mapped.constructor === Array) {
                this.addFact("action mapping constant", { action: action, from: field, "value": mapped[0] });
            }
            else {
                this.addFact("action mapping", { action: action, from: field, "to source": member, "to field": mapped });
            }
        }
        return this;
    };
    BSPhase.prototype.addQuery = function (view, query) {
        query.name = view;
        this._queries[view] = query;
        this.addView(view, "query", Object.keys(query.projectionMap || {}));
        this.changeset.merge(query.changeset(this.ixer));
        return this;
    };
    BSPhase.prototype.addArtifacts = function (artifacts) {
        var views = artifacts.views;
        for (var view in artifacts.views) {
            this._views[view] = "query";
        }
        for (var id in views)
            this.changeset.merge(views[id].changeset(app_1.eve));
        return this;
    };
    BSPhase.prototype.addUI = function (id, ui) {
        ui.id = id;
        this._uis[id] = ui;
        this.addEntity(id, id, ["system", "ui"]);
        this.changeset.merge(ui.changeset(this.ixer));
        return this;
    };
    return BSPhase;
})();
//-----------------------------------------------------------------------------
// Runtime Setup
//-----------------------------------------------------------------------------
app.init("bootstrap", function bootstrap() {
    //-----------------------------------------------------------------------------
    // Entity System
    //-----------------------------------------------------------------------------
    var phase = new BSPhase(app_1.eve);
    phase.addTable("manual entity", ["entity", "content"]);
    phase.addTable("sourced eav", ["entity", "attribute", "value", "source"]);
    phase.addTable("page content", ["page", "content"]);
    phase.addTable("entity page", ["entity", "page"]);
    phase.addTable("action entity", ["entity", "content", "source"]);
    phase
        .addEntity("entity", "entity", ["system"])
        .addEntity("collection", "collection", ["system"])
        .addEntity("system", "system", ["system", "collection"])
        .addEntity("union", "union", ["system", "collection"])
        .addEntity("query", "query", ["system", "collection"])
        .addEntity("table", "table", ["system", "collection"])
        .addEntity("ui", "ui", ["system", "collection"])
        .addEntity("home", "home", ["system"], undefined, (_a = ["\n      {entity|rep = directory}\n    "], _a.raw = ["\n      {entity|rep = directory}\n    "], utils_1.unpad(6)(_a)));
    phase.addUnion("entity eavs", ["entity", "attribute", "value"], true)
        .addUnionMember("entity eavs", "generated eav", { entity: "entity", attribute: "attribute", value: "value" })
        .addUnionMember("entity eavs", "sourced eav", { entity: "entity", attribute: "attribute", value: "value" })
        .addUnionMember("entity eavs", "added eavs");
    phase.addUnion("entity links", ["entity", "link", "type"])
        .addUnionMember("entity links", "eav entity links")
        .addUnionMember("entity links", "is a attributes", { entity: "entity", link: "collection", type: ["is a"] });
    phase.addUnion("directionless links", ["entity", "link"])
        .addUnionMember("directionless links", "entity links")
        .addUnionMember("directionless links", "entity links", { entity: "link", link: "entity" });
    phase.addUnion("collection entities", ["entity", "collection"])
        .addUnionMember("collection entities", "is a attributes");
    phase.addArtifacts(parser_1.parseDSL("\n    (query :$$view \"bs: index name\"\n      (display-name :id id :name raw)\n      (lowercase :text raw :result name)\n      (project! \"index name\" :id id :name name))\n  "));
    phase.addArtifacts(parser_1.parseDSL("\n    (query :$$view \"bs: entity\"\n      (entity-page :entity entity :page page)\n      (page-content :page page :content content)\n      (project! \"entity\" :entity entity :content content))\n  "));
    phase.addArtifacts(parser_1.parseDSL("\n    (query :$$view \"bs: unmodified added bits\"\n      (added-bits :entity entity :content content)\n      (negate (manual-entity :entity entity))\n      (project! \"unmodified added bits\" :entity entity :content content))\n  "));
    phase.addArtifacts(parser_1.parseDSL("\n    (query :$$view \"bs: is a attributes\"\n      (entity-eavs :attribute \"is a\" :entity entity :value value)\n      (project! \"is a attributes\" :collection value :entity entity))\n  "));
    // @HACK: this view is required because you can't currently join a select on the result of a function.
    // so we create a version of the eavs table that already has everything lowercased.
    phase.addArtifacts(parser_1.parseDSL("\n    (query :$$view \"bs: lowercase eavs\"\n      (entity-eavs :entity entity :attribute attribute :value value)\n      (lowercase :text value :result lowercased)\n      (project! \"lowercase eavs\" :entity entity :attribute attribute :value lowercased))\n  "));
    phase.addArtifacts(parser_1.parseDSL("\n    (query :$$view \"bs: eav entity links\"\n      (entity-eavs :entity entity :attribute attribute :value value)\n      (entity :entity value)\n      (project! \"eav entity links\" :entity entity :type attribute :link value))\n  "));
    phase.addArtifacts(parser_1.parseDSL("\n    (query :$$view \"bs: collection\"\n      (is-a-attributes :collection entity)\n      (query :$$view \"bs: collection count\"\n        (is-a-attributes :collection entity :entity child)\n        (count :count childCount))\n      (project! \"collection\" :collection entity :count childCount))\n  "));
    phase.addEntity("entity", "entity", ["system"]);
    phase.addEntity("collection", "collection", ["system"]);
    phase.addArtifacts(parser_1.parseDSL((_b = ["\n    (query :$$view \"bs: entity eavs from entities\"\n      (entity :entity entity)\n      (project! \"entity eavs\" :entity entity :attribute \"is a\" :value \"", "\"))\n  "], _b.raw = ["\n    (query :$$view \"bs: entity eavs from entities\"\n      (entity :entity entity)\n      (project! \"entity eavs\" :entity entity :attribute \"is a\" :value \"", "\"))\n  "], utils_1.unpad(4)(_b, utils_1.builtinId("entity")))));
    phase.addArtifacts(parser_1.parseDSL((_c = ["\n    (query :$$view \"bs: entity eavs from collections\"\n      (is-a-attributes :collection coll)\n      (project! \"entity eavs\" :entity coll :attribute \"is a\" :value \"", "\"))\n  "], _c.raw = ["\n    (query :$$view \"bs: entity eavs from collections\"\n      (is-a-attributes :collection coll)\n      (project! \"entity eavs\" :entity coll :attribute \"is a\" :value \"", "\"))\n  "], utils_1.unpad(4)(_c, utils_1.builtinId("collection")))));
    /*  phase.addArtifacts(parseDSL(unpad(4) `
        (query
          (entity :entity entity)
          (negate (query
            (directionless-links :entity entity :link link)
            (!= link "AUTOGENERATED entity THIS SHOULDN'T SHOW UP ANYWHERE")
            (!= link "AUTOGENERATED orphaned THIS SHOULDN'T SHOW UP ANYWHERE")
            ))
          (project! "entity eavs" :entity coll :attribute "is a" :value "AUTOGENERATED collection THIS SHOULDN'T SHOW UP ANYWHERE"))
    `));*/
    phase.addTable("ui pane", ["pane", "kind", "rep", "contains", "params"]);
    if (app_1.eve.find("ui pane").length === 0)
        phase.addFact("ui pane", { pane: "p1", kind: 0, rep: "entity", contains: "", params: "" });
    phase.apply(true);
    //-----------------------------------------------------------------------------
    // UI
    //-----------------------------------------------------------------------------
    phase = new BSPhase(app_1.eve);
    // @FIXME: These should probably be unionized.
    function resolve(table, fields) {
        return fields.map(function (field) { return (table + ": " + field); });
    }
    phase.addTable("ui template", resolve("ui template", ["template", "parent", "ix"]));
    phase.addTable("ui template binding", resolve("ui template binding", ["template", "query"]));
    phase.addTable("ui embed", resolve("ui embed", ["embed", "template", "parent", "ix"]));
    phase.addTable("ui embed scope", resolve("ui embed scope", ["embed", "key", "value"]));
    phase.addTable("ui embed scope binding", resolve("ui embed scope binding", ["embed", "key", "source", "alias"]));
    phase.addTable("ui attribute", resolve("ui attribute", ["template", "property", "value"]));
    phase.addTable("ui attribute binding", resolve("ui attribute binding", ["template", "property", "source", "alias"]));
    phase.addTable("ui event", resolve("ui event", ["template", "event"]));
    phase.addTable("ui event state", resolve("ui event state", ["template", "event", "key", "value"]));
    phase.addTable("ui event state binding", resolve("ui event state binding", ["template", "event", "key", "source", "alias"]));
    phase.addTable("system ui", ["template"]);
    phase.apply(true);
    //-----------------------------------------------------------------------------
    // Testing
    //-----------------------------------------------------------------------------
    phase = new BSPhase(app_1.eve);
    var testData = {
        "test data": [],
        pet: [],
        exotic: [],
        dangerous: [],
        cat: ["pet"],
        dog: ["pet"],
        fish: ["pet"],
        snake: ["pet", "exotic"],
        koala: ["pet", "exotic"],
        sloth: ["pet", "exotic"],
        kangaroo: ["exotic"],
        giraffe: ["exotic"],
        gorilla: ["exotic", "dangerous"],
        company: [],
        kodowa: ["company"],
        department: [],
        engineering: ["department"],
        operations: ["department"],
        magic: ["department"],
        employee: [],
        josh: ["employee"],
        corey: ["employee"],
        chris: ["employee"],
        rob: ["employee"],
        eric: ["employee"],
    };
    var testAttrs = {
        cat: { length: 4 },
        dog: { length: 3 },
        fish: { length: 1 },
        snake: { length: 4 },
        koala: { length: 3 },
        sloth: { length: 3 },
        engineering: { company: "kodowa" },
        operations: { company: "kodowa" },
        magic: { company: "kodowa" },
        josh: { department: "engineering", salary: 7 },
        corey: { department: "engineering", salary: 10 },
        chris: { department: "engineering", salary: 10 },
        eric: { department: "engineering", salary: 7 },
        rob: { department: "operations", salary: 10 },
    };
    for (var entity in testData)
        phase.addEntity(entity, entity, ["test data"].concat(testData[entity]), testAttrs[entity], "");
    // phase.addTable("department", ["department"])
    //   .addFact("department", {department: "engineering"})
    //   .addFact("department", {department: "operations"})
    //   .addFact("department", {department: "magic"});
    // phase.addTable("employee", ["department", "employee", "salary"])
    //   .addFact("employee", {department: "engineering", employee: "josh", salary: 10})
    //   .addFact("employee", {department: "engineering", employee: "corey", salary: 11})
    //   .addFact("employee", {department: "engineering", employee: "chris", salary: 7})
    //   .addFact("employee", {department: "operations", employee: "rob", salary: 7});
    phase.apply(true);
    window["p"] = phase;
    var _a, _b, _c;
});
window["bootstrap"] = exports;

},{"./app":9,"./parser":13,"./runtime":15,"./uiRenderer":17,"./utils":19}],11:[function(require,module,exports){
var utils_1 = require("./utils");
function sum(list) {
    var total = 0;
    for (var _i = 0; _i < list.length; _i++) {
        var num = list[_i];
        total += num;
    }
    return total;
}
function vecmul(a, b) {
    if (!a || !b || a.length !== b.length)
        throw new Error("Lists must be same length");
    var result = [];
    for (var i = 0, len = a.length; i < len; i++)
        result[i] = a[i] * b[i];
    return result;
}
var _layouts = [
    { size: 4, c: "big" },
    { size: 2, c: "detailed" },
    { size: 1, c: "normal", grouped: 2 },
];
function masonry(elem) {
    var _a = elem.seed, seed = _a === void 0 ? 0 : _a, _b = elem.rowSize, rowSize = _b === void 0 ? 8 : _b, _c = elem.layouts, layouts = _c === void 0 ? _layouts : _c, _d = elem.styles, styles = _d === void 0 ? undefined : _d, children = elem.children;
    var rand = utils_1.srand(seed);
    layouts.sort(utils_1.sortByField("size"));
    // Assign notional tiles an initial size based on the visual frequency of each layout
    var ix = 0;
    var tilesPerLayout = [];
    var totalLayoutFreq = 0;
    var sizes = [];
    for (var _i = 0; _i < layouts.length; _i++) {
        var layout = layouts[_i];
        layout.freq = layout.freq || 1 / layout.size;
        totalLayoutFreq += layout.freq;
    }
    for (var _e = 0; _e < layouts.length; _e++) {
        var layout = layouts[_e];
        sizes[ix] = layout.size;
        tilesPerLayout[ix++] = Math.round(layout.freq / totalLayoutFreq * children.length);
    }
    // Ensure every notional tile has an assigned size (to fix rounding errors)
    var total;
    var tryIx = 0;
    while ((total = sum(tilesPerLayout)) !== children.length) {
        if (sum(tilesPerLayout) > children.length)
            tilesPerLayout[tilesPerLayout.length - 1] -= 1;
        else if (sum(tilesPerLayout) < children.length)
            tilesPerLayout[tilesPerLayout.length - 1] += 1;
    }
    // Optimize distribution of notional tiles to maximally fill rows
    tryIx = 0, ix = 0;
    var minSize = layouts[layouts.length - 1].size;
    while (true) {
        var filledSize_1 = sum(vecmul(tilesPerLayout, sizes));
        var rowCount_1 = Math.ceil(filledSize_1 / rowSize);
        var delta = rowSize * rowCount_1 - filledSize_1;
        if (delta <= 0 || tryIx++ > 1000)
            break;
        // Since we'll be shifting one of the smallest layout tiles to a bigger size, we offset by that size
        if (ix === layouts.length - 1)
            ix = 0;
        if (delta >= layouts[ix].size - minSize) {
            tilesPerLayout[layouts.length - 1]--;
            tilesPerLayout[ix]++;
        }
        else if (ix === layouts.length - 2) {
            // The second smallest size was still too large, we're done.
            break;
        }
        ix++;
    }
    // Assign discrete tiles to sizes based on their relative size ordering
    children.sort(utils_1.sortByField("size"));
    var tiles = [], layoutIx = 0, tileIx = 0;
    for (var _f = 0; _f < tilesPerLayout.length; _f++) {
        var count = tilesPerLayout[_f];
        var layout = layouts[layoutIx++];
        if (!layout.grouped) {
            for (var ix_1 = tileIx; ix_1 < tileIx + count; ix_1++) {
                var tile = children[ix_1];
                tile.c = "directory-tile " + (tile.c || "") + " " + (layout.c || "");
                if (styles)
                    tile.c += " " + styles[tileIx % styles.length];
                if (layout.format)
                    tile = layout.format(tile);
                tiles.push({ c: "group " + (layout.c || ""), layout: layout, size: layout.size, children: [tile] });
            }
        }
        else {
            // Grouped layouts are grouped at this stage to keep the layout process 1-dimensional
            var added = 0;
            ;
            for (var ix_2 = tileIx; ix_2 < tileIx + count; ix_2 += layout.grouped) {
                var group = { c: "group " + (layout.c || ""), layout: layout, size: layout.size * layout.grouped, children: [] };
                for (var partIx = 0; partIx < layout.grouped && added < count; partIx++) {
                    var tile = children[ix_2 + partIx];
                    tile.c = "directory-tile " + (tile.c || "") + " " + (layout.c || "");
                    if (styles)
                        tile.c += " " + styles[(tileIx + partIx) % styles.length];
                    if (layout.format)
                        tile = layout.format(tile);
                    group.children.push(tile);
                    added++;
                }
                tiles.push(group);
            }
        }
        tileIx += count;
    }
    // @TODO: Pull tiles from bag, distributing them evenly into rows
    var filledSize = sum(vecmul(tilesPerLayout, sizes));
    var rowCount = Math.ceil(filledSize / rowSize);
    var rows = [];
    for (var ix_3 = 0; ix_3 < rowCount; ix_3++)
        rows.push({ c: "masonry-row", children: [], size: 0 });
    tryIx = 0;
    var rowIx = 0;
    for (var _g = 0; _g < tiles.length; _g++) {
        var tile = tiles[_g];
        var size = tile.layout.size * (tile.layout.grouped || 1);
        var placed = false;
        var attempts = 0;
        while (!placed) {
            var row = rows[rowIx];
            if (row.size + size <= rowSize) {
                row.size += size;
                row.children.push(tile);
                placed = true;
            }
            rowIx++;
            if (rowIx >= rowCount)
                rowIx = 0;
            attempts++;
            if (attempts === rowCount)
                break;
        }
        if (!placed)
            console.error("Could not place tile", tile);
    }
    ix = 0;
    // Shuffle the row contents and the set of rows for pleasing irregularity
    for (var _h = 0; _h < rows.length; _h++) {
        var row = rows[_h];
        utils_1.shuffle(row.children, rand);
    }
    utils_1.shuffle(rows, rand);
    elem.c = "masonry " + (elem.c || "");
    elem.children = rows;
    return elem;
}
exports.masonry = masonry;

},{"./utils":19}],12:[function(require,module,exports){
function now() {
    if (window.performance) {
        return window.performance.now();
    }
    return (new Date()).getTime();
}
function shallowEquals(a, b) {
    if (a === b)
        return true;
    if (!a || !b)
        return false;
    for (var k in a) {
        if (a[k] !== b[k])
            return false;
    }
    for (var k in b) {
        if (b[k] !== a[k])
            return false;
    }
    return true;
}
function postAnimationRemove(elements) {
    for (var _i = 0; _i < elements.length; _i++) {
        var elem = elements[_i];
        if (elem.parentNode)
            elem.parentNode.removeChild(elem);
    }
}
var Renderer = (function () {
    function Renderer() {
        this.content = document.createElement("div");
        this.content.className = "__root";
        this.elementCache = { "__root": this.content };
        this.prevTree = {};
        this.tree = {};
        this.postRenders = [];
        this.lastDiff = { adds: [], updates: {} };
        var self = this;
        this.handleEvent = function handleEvent(e) {
            var id = (e.currentTarget || e.target)["_id"];
            var elem = self.tree[id];
            if (!elem)
                return;
            var handler = elem[e.type];
            if (handler) {
                handler(e, elem);
            }
        };
    }
    Renderer.compile = function (elem) {
        if (!elem.id)
            throw new Error("Cannot compile element with id " + elem.id);
        var renderer = Renderer._compileRenderer[elem.id];
        if (!renderer)
            renderer = Renderer._compileRenderer[elem.id] = new Renderer();
        renderer.render([elem]);
        return renderer.elementCache[elem.id];
    };
    Renderer.prototype.reset = function () {
        this.prevTree = this.tree;
        this.tree = {};
        this.postRenders = [];
    };
    Renderer.prototype.domify = function () {
        var fakePrev = {}; //create an empty object once instead of every instance of the loop
        var elements = this.tree;
        var prevElements = this.prevTree;
        var diff = this.lastDiff;
        var adds = diff.adds;
        var updates = diff.updates;
        var elemKeys = Object.keys(updates);
        var elementCache = this.elementCache;
        var tempTween = {};
        //Create all the new elements to ensure that they're there when they need to be
        //parented
        for (var i = 0, len = adds.length; i < len; i++) {
            var id = adds[i];
            var cur = elements[id];
            var div;
            if (cur.svg) {
                div = document.createElementNS("http://www.w3.org/2000/svg", cur.t || "rect");
            }
            else {
                div = document.createElement(cur.t || "div");
            }
            div._id = id;
            elementCache[id] = div;
            if (cur.enter) {
                if (cur.enter.delay) {
                    cur.enter.display = "auto";
                    div.style.display = "none";
                }
                Velocity(div, cur.enter, cur.enter);
            }
        }
        for (var i = 0, len = elemKeys.length; i < len; i++) {
            var id = elemKeys[i];
            var cur = elements[id];
            var prev = prevElements[id] || fakePrev;
            var type = updates[id];
            var div;
            if (type === "replaced") {
                var me = elementCache[id];
                if (me.parentNode)
                    me.parentNode.removeChild(me);
                if (cur.svg) {
                    div = document.createElementNS("http://www.w3.org/2000/svg", cur.t || "rect");
                }
                else {
                    div = document.createElement(cur.t || "div");
                }
                prev = fakePrev;
                div._id = id;
                elementCache[id] = div;
            }
            else if (type === "removed") {
                //NOTE: Batching the removes such that you only remove the parent
                //didn't actually make this faster surprisingly. Given that this
                //strategy is much simpler and there's no noticable perf difference
                //we'll just do the dumb thing and remove all the children one by one.
                var me = elementCache[id];
                if (prev.leave) {
                    prev.leave.complete = postAnimationRemove;
                    if (prev.leave.absolute) {
                        me.style.position = "absolute";
                    }
                    Velocity(me, prev.leave, prev.leave);
                }
                else if (me.parentNode)
                    me.parentNode.removeChild(me);
                elementCache[id] = null;
                continue;
            }
            else {
                div = elementCache[id];
            }
            var style = div.style;
            if (cur.c !== prev.c)
                div.className = cur.c;
            if (cur.draggable !== prev.draggable)
                div.draggable = cur.draggable === undefined ? null : "true";
            if (cur.contentEditable !== prev.contentEditable)
                div.contentEditable = cur.contentEditable !== undefined ? JSON.stringify(cur.contentEditable) : "inherit";
            if (cur.colspan !== prev.colspan)
                div.colSpan = cur.colspan;
            if (cur.placeholder !== prev.placeholder)
                div.setAttribute("placeholder", cur.placeholder);
            if (cur.selected !== prev.selected)
                div.selected = cur.selected;
            if (cur.value !== prev.value && div.value !== cur.value)
                div.value = cur.value;
            if (cur.t === "input" && cur.type !== prev.type)
                div.type = cur.type;
            if (cur.t === "input" && cur.checked !== prev.checked)
                div.checked = cur.checked;
            if ((cur.text !== prev.text || cur.strictText) && div.textContent !== cur.text)
                div.textContent = cur.text === undefined ? "" : cur.text;
            if (cur.tabindex !== prev.tabindex)
                div.setAttribute("tabindex", cur.tabindex);
            if (cur.href !== prev.href)
                div.setAttribute("href", cur.href);
            if (cur.src !== prev.src)
                div.setAttribute("src", cur.src);
            if (cur.target !== prev.target)
                div.setAttribute("target", cur.target);
            if (cur.data !== prev.data)
                div.setAttribute("data", cur.data);
            if (cur.download !== prev.download)
                div.setAttribute("download", cur.download);
            if (cur.allowfullscreen !== prev.allowfullscreen)
                div.setAttribute("allowfullscreen", cur.allowfullscreen);
            // animateable properties
            var tween = cur.tween || tempTween;
            if (cur.flex !== prev.flex) {
                if (tween.flex)
                    tempTween.flex = cur.flex;
                else
                    style.flex = cur.flex === undefined ? "" : cur.flex;
            }
            if (cur.left !== prev.left) {
                if (tween.left)
                    tempTween.left = cur.left;
                else
                    style.left = cur.left === undefined ? "" : cur.left;
            }
            if (cur.top !== prev.top) {
                if (tween.top)
                    tempTween.top = cur.top;
                else
                    style.top = cur.top === undefined ? "" : cur.top;
            }
            if (cur.height !== prev.height) {
                if (tween.height)
                    tempTween.height = cur.height;
                else
                    style.height = cur.height === undefined ? "auto" : cur.height;
            }
            if (cur.width !== prev.width) {
                if (tween.width)
                    tempTween.width = cur.width;
                else
                    style.width = cur.width === undefined ? "auto" : cur.width;
            }
            if (cur.zIndex !== prev.zIndex) {
                if (tween.zIndex)
                    tempTween.zIndex = cur.zIndex;
                else
                    style.zIndex = cur.zIndex;
            }
            if (cur.backgroundColor !== prev.backgroundColor) {
                if (tween.backgroundColor)
                    tempTween.backgroundColor = cur.backgroundColor;
                else
                    style.backgroundColor = cur.backgroundColor || "transparent";
            }
            if (cur.borderColor !== prev.borderColor) {
                if (tween.borderColor)
                    tempTween.borderColor = cur.borderColor;
                else
                    style.borderColor = cur.borderColor || "none";
            }
            if (cur.borderWidth !== prev.borderWidth) {
                if (tween.borderWidth)
                    tempTween.borderWidth = cur.borderWidth;
                else
                    style.borderWidth = cur.borderWidth || 0;
            }
            if (cur.borderRadius !== prev.borderRadius) {
                if (tween.borderRadius)
                    tempTween.borderRadius = cur.borderRadius;
                else
                    style.borderRadius = (cur.borderRadius || 0) + "px";
            }
            if (cur.opacity !== prev.opacity) {
                if (tween.opacity)
                    tempTween.opacity = cur.opacity;
                else
                    style.opacity = cur.opacity === undefined ? 1 : cur.opacity;
            }
            if (cur.fontSize !== prev.fontSize) {
                if (tween.fontSize)
                    tempTween.fontSize = cur.fontSize;
                else
                    style.fontSize = cur.fontSize;
            }
            if (cur.color !== prev.color) {
                if (tween.color)
                    tempTween.color = cur.color;
                else
                    style.color = cur.color || "inherit";
            }
            var animKeys = Object.keys(tempTween);
            if (animKeys.length) {
                Velocity(div, tempTween, tween);
                tempTween = {};
            }
            // non-animation style properties
            if (cur.backgroundImage !== prev.backgroundImage)
                style.backgroundImage = "url('" + cur.backgroundImage + "')";
            if (cur.border !== prev.border)
                style.border = cur.border || "none";
            if (cur.textAlign !== prev.textAlign) {
                style.alignItems = cur.textAlign;
                if (cur.textAlign === "center") {
                    style.textAlign = "center";
                }
                else if (cur.textAlign === "flex-end") {
                    style.textAlign = "right";
                }
                else {
                    style.textAlign = "left";
                }
            }
            if (cur.verticalAlign !== prev.verticalAlign)
                style.justifyContent = cur.verticalAlign;
            if (cur.fontFamily !== prev.fontFamily)
                style.fontFamily = cur.fontFamily || "inherit";
            if (cur.transform !== prev.transform)
                style.transform = cur.transform || "none";
            if (cur.style !== prev.style)
                div.setAttribute("style", cur.style);
            if (cur.dangerouslySetInnerHTML !== prev.dangerouslySetInnerHTML)
                div.innerHTML = cur.dangerouslySetInnerHTML;
            // debug/programmatic properties
            if (cur.semantic !== prev.semantic)
                div.setAttribute("data-semantic", cur.semantic);
            if (cur.debug !== prev.debug)
                div.setAttribute("data-debug", cur.debug);
            // SVG properties
            if (cur.svg) {
                if (cur.fill !== prev.fill)
                    div.setAttributeNS(null, "fill", cur.fill);
                if (cur.stroke !== prev.stroke)
                    div.setAttributeNS(null, "stroke", cur.stroke);
                if (cur.strokeWidth !== prev.strokeWidth)
                    div.setAttributeNS(null, "stroke-width", cur.strokeWidth);
                if (cur.d !== prev.d)
                    div.setAttributeNS(null, "d", cur.d);
                if (cur.c !== prev.c)
                    div.setAttributeNS(null, "class", cur.c);
                if (cur.x !== prev.x)
                    div.setAttributeNS(null, "x", cur.x);
                if (cur.y !== prev.y)
                    div.setAttributeNS(null, "y", cur.y);
                if (cur.dx !== prev.dx)
                    div.setAttributeNS(null, "dx", cur.dx);
                if (cur.dy !== prev.dy)
                    div.setAttributeNS(null, "dy", cur.dy);
                if (cur.cx !== prev.cx)
                    div.setAttributeNS(null, "cx", cur.cx);
                if (cur.cy !== prev.cy)
                    div.setAttributeNS(null, "cy", cur.cy);
                if (cur.r !== prev.r)
                    div.setAttributeNS(null, "r", cur.r);
                if (cur.height !== prev.height)
                    div.setAttributeNS(null, "height", cur.height);
                if (cur.width !== prev.width)
                    div.setAttributeNS(null, "width", cur.width);
                if (cur.xlinkhref !== prev.xlinkhref)
                    div.setAttributeNS('http://www.w3.org/1999/xlink', "href", cur.xlinkhref);
                if (cur.startOffset !== prev.startOffset)
                    div.setAttributeNS(null, "startOffset", cur.startOffset);
                if (cur.id !== prev.id)
                    div.setAttributeNS(null, "id", cur.id);
                if (cur.viewBox !== prev.viewBox)
                    div.setAttributeNS(null, "viewBox", cur.viewBox);
                if (cur.transform !== prev.transform)
                    div.setAttributeNS(null, "transform", cur.transform);
                if (cur.draggable !== prev.draggable)
                    div.setAttributeNS(null, "draggable", cur.draggable);
                if (cur.textAnchor !== prev.textAnchor)
                    div.setAttributeNS(null, "text-anchor", cur.textAnchor);
            }
            //events
            if (cur.dblclick !== prev.dblclick)
                div.ondblclick = cur.dblclick !== undefined ? this.handleEvent : undefined;
            if (cur.click !== prev.click)
                div.onclick = cur.click !== undefined ? this.handleEvent : undefined;
            if (cur.contextmenu !== prev.contextmenu)
                div.oncontextmenu = cur.contextmenu !== undefined ? this.handleEvent : undefined;
            if (cur.mousedown !== prev.mousedown)
                div.onmousedown = cur.mousedown !== undefined ? this.handleEvent : undefined;
            if (cur.mousemove !== prev.mousemove)
                div.onmousemove = cur.mousemove !== undefined ? this.handleEvent : undefined;
            if (cur.mouseup !== prev.mouseup)
                div.onmouseup = cur.mouseup !== undefined ? this.handleEvent : undefined;
            if (cur.mouseover !== prev.mouseover)
                div.onmouseover = cur.mouseover !== undefined ? this.handleEvent : undefined;
            if (cur.mouseout !== prev.mouseout)
                div.onmouseout = cur.mouseout !== undefined ? this.handleEvent : undefined;
            if (cur.mouseleave !== prev.mouseleave)
                div.onmouseleave = cur.mouseleave !== undefined ? this.handleEvent : undefined;
            if (cur.mousewheel !== prev.mousewheel)
                div.onmouseheel = cur.mousewheel !== undefined ? this.handleEvent : undefined;
            if (cur.dragover !== prev.dragover)
                div.ondragover = cur.dragover !== undefined ? this.handleEvent : undefined;
            if (cur.dragstart !== prev.dragstart)
                div.ondragstart = cur.dragstart !== undefined ? this.handleEvent : undefined;
            if (cur.dragend !== prev.dragend)
                div.ondragend = cur.dragend !== undefined ? this.handleEvent : undefined;
            if (cur.drag !== prev.drag)
                div.ondrag = cur.drag !== undefined ? this.handleEvent : undefined;
            if (cur.drop !== prev.drop)
                div.ondrop = cur.drop !== undefined ? this.handleEvent : undefined;
            if (cur.scroll !== prev.scroll)
                div.onscroll = cur.scroll !== undefined ? this.handleEvent : undefined;
            if (cur.focus !== prev.focus)
                div.onfocus = cur.focus !== undefined ? this.handleEvent : undefined;
            if (cur.blur !== prev.blur)
                div.onblur = cur.blur !== undefined ? this.handleEvent : undefined;
            if (cur.input !== prev.input)
                div.oninput = cur.input !== undefined ? this.handleEvent : undefined;
            if (cur.change !== prev.change)
                div.onchange = cur.change !== undefined ? this.handleEvent : undefined;
            if (cur.keyup !== prev.keyup)
                div.onkeyup = cur.keyup !== undefined ? this.handleEvent : undefined;
            if (cur.keydown !== prev.keydown)
                div.onkeydown = cur.keydown !== undefined ? this.handleEvent : undefined;
            if (type === "added" || type === "replaced" || type === "moved") {
                var parentEl = elementCache[cur.parent];
                if (parentEl) {
                    if (cur.ix >= parentEl.children.length) {
                        parentEl.appendChild(div);
                    }
                    else {
                        parentEl.insertBefore(div, parentEl.children[cur.ix]);
                    }
                }
            }
        }
    };
    Renderer.prototype.diff = function () {
        var a = this.prevTree;
        var b = this.tree;
        var as = Object.keys(a);
        var bs = Object.keys(b);
        var updated = {};
        var adds = [];
        for (var i = 0, len = as.length; i < len; i++) {
            var id = as[i];
            var curA = a[id];
            var curB = b[id];
            if (curB === undefined) {
                updated[id] = "removed";
                continue;
            }
            if (curA.t !== curB.t) {
                updated[id] = "replaced";
                continue;
            }
            if (curA.ix !== curB.ix || curA.parent !== curB.parent) {
                updated[id] = "moved";
                continue;
            }
            if (!curB.dirty
                && curA.c === curB.c
                && curA.key === curB.key
                && curA.dangerouslySetInnerHTML === curB.dangerouslySetInnerHTML
                && curA.tabindex === curB.tabindex
                && curA.href === curB.href
                && curA.src === curB.src
                && curA.data === curB.data
                && curA.download === curB.download
                && curA.allowfullscreen === curB.allowfullscreen
                && curA.placeholder === curB.placeholder
                && curA.selected === curB.selected
                && curA.draggable === curB.draggable
                && curA.contentEditable === curB.contentEditable
                && curA.value === curB.value
                && curA.target === curB.target
                && curA.type === curB.type
                && curA.checked === curB.checked
                && curA.text === curB.text
                && curA.top === curB.top
                && curA.flex === curB.flex
                && curA.left === curB.left
                && curA.width === curB.width
                && curA.height === curB.height
                && curA.zIndex === curB.zIndex
                && curA.backgroundColor === curB.backgroundColor
                && curA.backgroundImage === curB.backgroundImage
                && curA.color === curB.color
                && curA.colspan === curB.colspan
                && curA.border === curB.border
                && curA.borderColor === curB.borderColor
                && curA.borderWidth === curB.borderWidth
                && curA.borderRadius === curB.borderRadius
                && curA.opacity === curB.opacity
                && curA.fontFamily === curB.fontFamily
                && curA.fontSize === curB.fontSize
                && curA.textAlign === curB.textAlign
                && curA.transform === curB.transform
                && curA.verticalAlign === curB.verticalAlign
                && curA.semantic === curB.semantic
                && curA.debug === curB.debug
                && curA.style === curB.style
                && (curB.svg === undefined || (curA.x === curB.x
                    && curA.y === curB.y
                    && curA.dx === curB.dx
                    && curA.dy === curB.dy
                    && curA.cx === curB.cx
                    && curA.cy === curB.cy
                    && curA.r === curB.r
                    && curA.d === curB.d
                    && curA.fill === curB.fill
                    && curA.stroke === curB.stroke
                    && curA.strokeWidth === curB.strokeWidth
                    && curA.startOffset === curB.startOffset
                    && curA.textAnchor === curB.textAnchor
                    && curA.viewBox === curB.viewBox
                    && curA.xlinkhref === curB.xlinkhref))) {
                continue;
            }
            updated[id] = "updated";
        }
        for (var i = 0, len = bs.length; i < len; i++) {
            var id = bs[i];
            var curA = a[id];
            if (curA === undefined) {
                adds.push(id);
                updated[id] = "added";
                continue;
            }
        }
        this.lastDiff = { adds: adds, updates: updated };
        return this.lastDiff;
    };
    Renderer.prototype.prepare = function (root) {
        var elemLen = 1;
        var tree = this.tree;
        var elements = [root];
        var elem;
        for (var elemIx = 0; elemIx < elemLen; elemIx++) {
            elem = elements[elemIx];
            if (elem.parent === undefined)
                elem.parent = "__root";
            if (elem.id === undefined)
                elem.id = "__root__" + elemIx;
            tree[elem.id] = elem;
            if (elem.postRender !== undefined) {
                this.postRenders.push(elem);
            }
            var children = elem.children;
            if (children !== undefined) {
                for (var childIx = 0, len = children.length; childIx < len; childIx++) {
                    var child = children[childIx];
                    if (child === undefined)
                        continue;
                    if (child.id === undefined) {
                        child.id = elem.id + "__" + childIx;
                    }
                    if (child.ix === undefined) {
                        child.ix = childIx;
                    }
                    if (child.parent === undefined) {
                        child.parent = elem.id;
                    }
                    elements.push(child);
                    elemLen++;
                }
            }
        }
        return tree;
    };
    Renderer.prototype.postDomify = function () {
        var postRenders = this.postRenders;
        var diff = this.lastDiff.updates;
        var elementCache = this.elementCache;
        for (var i = 0, len = postRenders.length; i < len; i++) {
            var elem = postRenders[i];
            var id = elem.id;
            if (diff[id] === "updated" || diff[id] === "added" || diff[id] === "replaced" || elem.dirty || diff[id] === "moved") {
                elem.postRender(elementCache[elem.id], elem);
            }
        }
    };
    Renderer.prototype.render = function (elems) {
        this.reset();
        // We sort elements by depth to allow them to be self referential.
        elems.sort(function (a, b) { return (a.parent ? a.parent.split("__").length : 0) - (b.parent ? b.parent.split("__").length : 0); });
        var start = now();
        for (var _i = 0; _i < elems.length; _i++) {
            var elem = elems[_i];
            var post = this.prepare(elem);
        }
        var prepare = now();
        var d = this.diff();
        var diff = now();
        this.domify();
        var domify = now();
        this.postDomify();
        var postDomify = now();
        var time = now() - start;
        if (time > 5) {
            console.log("slow render (> 5ms): ", time, {
                prepare: prepare - start,
                diff: diff - prepare,
                domify: domify - diff,
                postDomify: postDomify - domify
            });
        }
    };
    // @TODO: A more performant implementation would have a way of rendering subtrees and just have a lambda Renderer to compile into
    Renderer._compileRenderer = {};
    return Renderer;
})();
exports.Renderer = Renderer;

},{}],13:[function(require,module,exports){
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var utils_1 = require("./utils");
var runtime = require("./runtime");
var app_1 = require("./app");
var ParseError = (function (_super) {
    __extends(ParseError, _super);
    function ParseError(message, line, lineIx, charIx, length) {
        if (charIx === void 0) { charIx = 0; }
        if (length === void 0) { length = line && (line.length - charIx); }
        _super.call(this, message);
        this.message = message;
        this.line = line;
        this.lineIx = lineIx;
        this.charIx = charIx;
        this.length = length;
        this.name = "Parse Error";
    }
    ParseError.prototype.toString = function () {
        return (_a = ["\n      ", ": ", "\n      ", "\n      ", "\n      ", "\n    "], _a.raw = ["\n      ", ": ", "\n      ", "\n      ", "\n      ", "\n    "], utils_1.unpad(6)(_a, this.name, this.message, this.lineIx !== undefined ? "On line " + (this.lineIx + 1) + ":" + this.charIx : "", this.line, utils_1.underline(this.charIx, this.length)));
        var _a;
    };
    return ParseError;
})(Error);
function readWhile(str, pattern, startIx) {
    var endIx = startIx;
    while (str[endIx] !== undefined && str[endIx].match(pattern))
        endIx++;
    return str.slice(startIx, endIx);
}
function readUntil(str, sentinel, startIx, unsatisfiedErr) {
    var endIx = str.indexOf(sentinel, startIx);
    if (endIx === -1) {
        if (unsatisfiedErr)
            return unsatisfiedErr;
        return str.slice(startIx);
    }
    return str.slice(startIx, endIx);
}
function readUntilAny(str, sentinels, startIx, unsatisfiedErr) {
    var endIx = -1;
    for (var _i = 0; _i < sentinels.length; _i++) {
        var sentinel = sentinels[_i];
        var ix = str.indexOf(sentinel, startIx);
        if (ix === -1 || endIx !== -1 && ix > endIx)
            continue;
        endIx = ix;
    }
    if (endIx === -1) {
        if (unsatisfiedErr)
            return unsatisfiedErr;
        return str.slice(startIx);
    }
    return str.slice(startIx, endIx);
}
// export function parseUI(str:string):UIElem {
//   let root:UIElem = {};
//   let errors = [];
//   let lineIx = 0;
//   let lines = str.split("\n");
//   let stack:{indent: number, elem: UIElem}[] = [{indent: -2, elem: root}];
//   // @FIXME: Chunk into element chunks instead of lines to enable in-argument continuation.
//   for(let line of lines) {
//     let charIx = 0;
//     while(line[charIx] === " ") charIx++;
//     let indent = charIx;
//     if(line[charIx] === undefined)  continue;
//     let parent:UIElem;
//     for(let stackIx = stack.length - 1; stackIx >= 0; stackIx--) {
//       if(indent > stack[stackIx].indent) {
//         parent = stack[stackIx].elem;
//         break;
//       } else stack.pop();
//     }
//     let keyword = readUntil(line, " ", charIx);
//     charIx += keyword.length;
//     if(keyword[0] === "~" || keyword[0] === "%") { // Handle binding
//       charIx -= keyword.length - 1;
//       let kind = keyword[0] === "~" ? "plan" : "query";
//       if(!parent.binding) {
//         parent.binding = line.slice(charIx);
//         parent.bindingKind = kind;
//       } else if(kind === parent.bindingKind) parent.binding += "\n" + line.slice(charIx);
//       else {
//         errors.push(new ParseError(`UI must be bound to a single type of query.`, line, lineIx));
//         continue;
//       }
//       charIx = line.length;
//     } else if(keyword[0] === "@") { // Handle event
//       charIx -= keyword.length - 1;
//       let err;
//       while(line[charIx] === " ") charIx++;
//       let lastIx = charIx;
//       let eventRaw = readUntil(line, "{", charIx);
//       charIx += eventRaw.length;
//       let event = eventRaw.trim();
//       if(!event) err = new ParseError(`UI event must specify a valid event name`, line, lineIx, lastIx, eventRaw.length);
//       let state;
//       [state, charIx] = getMapArgs(line, lineIx, charIx);
//       if(state instanceof Error && !err) err = state;
//       if(err) {
//         errors.push(err);
//         lineIx++;
//         continue;
//       }
//       if(!parent.events) parent.events = {};
//       parent.events[event] = state;
//     } else if(keyword[0] === ">") { // Handle embed
//       charIx -= keyword.length - 1;
//       let err;
//       while(line[charIx] === " ") charIx++;
//       let lastIx = charIx;
//       let embedIdRaw = readUntil(line, "{", charIx);
//       charIx += embedIdRaw.length;
//       let embedId = embedIdRaw.trim();
//       if(!embedId) err = new ParseError(`UI embed must specify a valid element id`, line, lineIx, lastIx, embedIdRaw.length);
//       let scope;
//       [scope = {}, charIx] = getMapArgs(line, lineIx, charIx);
//       if(scope instanceof Error && !err) err = scope;
//       if(err) {
//         errors.push(err);
//         lineIx++;
//         continue;
//       }
//       let elem = {embedded: scope, id: embedId};
//       if(!parent.children) parent.children = [];
//       parent.children.push(elem);
//       stack.push({indent, elem});
//     } else { // Handle element
//       let err;
//       if(!keyword) err = new ParseError(`UI element must specify a valid tag name`, line, lineIx, charIx, 0);
//       while(line[charIx] === " ") charIx++;
//       let classesRaw = readUntil(line, "{", charIx);
//       charIx += classesRaw.length;
//       let classes = classesRaw.trim();
//       let attributes;
//       [attributes = {}, charIx] = getMapArgs(line, lineIx, charIx);
//       if(attributes instanceof Error && !err) err = attributes;
//       if(err) {
//         errors.push(err);
//         lineIx++;
//         continue;
//       }
//       attributes["t"] = keyword;
//       if(classes) attributes["c"] = classes;
//       let elem:UIElem = {id: attributes["id"], attributes};
//       if(!parent.children) parent.children = [];
//       parent.children.push(elem);
//       stack.push({indent, elem});
//     }
//     lineIx++;
//   }
//   if(errors.length) {
//     for(let err of errors) {
//       console.error(err);
//     }
//   }
//   return root;
// }
//-----------------------------------------------------------------------------
// Eve DSL Parser
//-----------------------------------------------------------------------------
var TOKEN_TYPE;
(function (TOKEN_TYPE) {
    TOKEN_TYPE[TOKEN_TYPE["EXPR"] = 0] = "EXPR";
    TOKEN_TYPE[TOKEN_TYPE["IDENTIFIER"] = 1] = "IDENTIFIER";
    TOKEN_TYPE[TOKEN_TYPE["KEYWORD"] = 2] = "KEYWORD";
    TOKEN_TYPE[TOKEN_TYPE["STRING"] = 3] = "STRING";
    TOKEN_TYPE[TOKEN_TYPE["LITERAL"] = 4] = "LITERAL";
})(TOKEN_TYPE || (TOKEN_TYPE = {}));
;
var Token = (function () {
    function Token(type, value, lineIx, charIx) {
        this.type = type;
        this.value = value;
        this.lineIx = lineIx;
        this.charIx = charIx;
    }
    Token.identifier = function (value, lineIx, charIx) {
        return new Token(Token.TYPE.IDENTIFIER, value, lineIx, charIx);
    };
    Token.keyword = function (value, lineIx, charIx) {
        return new Token(Token.TYPE.KEYWORD, value, lineIx, charIx);
    };
    Token.string = function (value, lineIx, charIx) {
        return new Token(Token.TYPE.STRING, value, lineIx, charIx);
    };
    Token.literal = function (value, lineIx, charIx) {
        return new Token(Token.TYPE.LITERAL, value, lineIx, charIx);
    };
    Token.prototype.toString = function () {
        if (this.type === Token.TYPE.KEYWORD)
            return ":" + this.value;
        else if (this.type === Token.TYPE.STRING)
            return "\"" + this.value + "\"";
        else
            return this.value.toString();
    };
    Token.TYPE = TOKEN_TYPE;
    return Token;
})();
exports.Token = Token;
var Sexpr = (function () {
    function Sexpr(val, lineIx, charIx, syntax) {
        if (syntax === void 0) { syntax = "expr"; }
        this.lineIx = lineIx;
        this.charIx = charIx;
        this.syntax = syntax;
        this.type = Token.TYPE.EXPR;
        if (val)
            this.value = val.slice();
    }
    Sexpr.list = function (value, lineIx, charIx, syntax) {
        if (value === void 0) { value = []; }
        value = value.slice();
        value.unshift(Token.identifier("list", lineIx, charIx ? charIx + 1 : undefined));
        return new Sexpr(value, lineIx, charIx, syntax ? "list" : undefined);
    };
    Sexpr.hash = function (value, lineIx, charIx, syntax) {
        if (value === void 0) { value = []; }
        value = value.slice();
        value.unshift(Token.identifier("hash", lineIx, charIx ? charIx + 1 : undefined));
        return new Sexpr(value, lineIx, charIx, syntax ? "hash" : undefined);
    };
    Sexpr.asSexprs = function (values) {
        for (var _i = 0; _i < values.length; _i++) {
            var raw = values[_i];
            if (!(raw instanceof Sexpr))
                throw new ParseError("All top level entries must be expressions (got " + raw + ")", undefined, raw.lineIx, raw.charIx);
            else {
                var op = raw.operator;
                if (op.type !== Token.TYPE.IDENTIFIER)
                    throw new ParseError("All expressions must begin with an identifier", undefined, raw.lineIx, raw.charIx);
            }
        }
        return values;
    };
    Sexpr.prototype.toString = function () {
        var content = this.value && this.value.map(function (token) { return token.toString(); }).join(" ");
        var argsContent = this.value && this.arguments.map(function (token) { return token.toString(); }).join(" ");
        if (this.syntax === "hash")
            return "{" + argsContent + "}";
        else if (this.syntax === "list")
            return "[" + argsContent + "]";
        else
            return "(" + content + ")";
    };
    Sexpr.prototype.push = function (val) {
        this.value = this.value || [];
        return this.value.push(val);
    };
    Sexpr.prototype.nth = function (n, val) {
        if (val) {
            this.value = this.value || [];
            return this.value[n] = val;
        }
        return this.value && this.value[n];
    };
    Object.defineProperty(Sexpr.prototype, "operator", {
        get: function () {
            return this.value && this.value[0];
        },
        set: function (op) {
            this.value = this.value || [];
            this.value[0] = op;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(Sexpr.prototype, "arguments", {
        get: function () {
            return this.value && this.value.slice(1);
        },
        set: function (args) {
            this.value = this.value || [];
            this.value.length = 1;
            this.value.push.apply(this.value, args);
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(Sexpr.prototype, "length", {
        get: function () {
            return this.value && this.value.length;
        },
        enumerable: true,
        configurable: true
    });
    return Sexpr;
})();
exports.Sexpr = Sexpr;
var TOKEN_TO_TYPE = {
    "(": "expr",
    ")": "expr",
    "[": "list",
    "]": "list",
    "{": "hash",
    "}": "hash"
};
var hygienicSymbolCounter = 0;
function readSexprs(text) {
    var root = Sexpr.list();
    var token;
    var sexpr = root;
    var sexprs = [root];
    var lines = text.split("\n");
    var lineIx = 0;
    var mode;
    for (var _i = 0; _i < lines.length; _i++) {
        var line = lines[_i];
        var line_1 = lines[lineIx];
        var charIx = 0;
        if (mode === "string")
            token.value += "\n";
        while (charIx < line_1.length) {
            if (mode === "string") {
                if (line_1[charIx] === "\"" && line_1[charIx - 1] !== "\\") {
                    sexpr.push(token);
                    token = mode = undefined;
                    charIx++;
                }
                else
                    token.value += line_1[charIx++];
                continue;
            }
            var padding = readWhile(line_1, /\s/, charIx);
            charIx += padding.length;
            if (padding.length) {
                if (token)
                    sexpr.push(token);
                token = undefined;
            }
            if (charIx >= line_1.length)
                continue;
            if (line_1[charIx] === ";") {
                charIx = line_1.length;
            }
            else if (line_1[charIx] === "\"") {
                if (!sexpr.length)
                    throw new ParseError("Literal must be an argument in a sexpr.", line_1, lineIx, charIx);
                mode = "string";
                token = Token.string("", lineIx, charIx);
                charIx++;
            }
            else if (line_1[charIx] === ":") {
                if (!sexpr.length)
                    throw new ParseError("Literal must be an argument in a sexpr.", line_1, lineIx, charIx);
                var keyword = readUntilAny(line_1, [" ", ")", "]", "}"], ++charIx);
                sexpr.push(Token.keyword(keyword, lineIx, charIx - 1));
                charIx += keyword.length;
            }
            else if (line_1[charIx] === "(" || line_1[charIx] === "[" || line_1[charIx] === "{") {
                if (token)
                    throw new ParseError("Sexpr arguments must be space separated.", line_1, lineIx, charIx);
                var type = TOKEN_TO_TYPE[line_1[charIx]];
                if (type === "hash")
                    sexpr = Sexpr.hash(undefined, lineIx, charIx);
                else if (type === "list")
                    sexpr = Sexpr.list(undefined, lineIx, charIx);
                else
                    sexpr = new Sexpr(undefined, lineIx, charIx);
                sexpr.syntax = type;
                sexprs.push(sexpr);
                charIx++;
            }
            else if (line_1[charIx] === ")" || line_1[charIx] === "]" || line_1[charIx] === "}") {
                var child = sexprs.pop();
                var type = TOKEN_TO_TYPE[line_1[charIx]];
                if (child.syntax !== type)
                    throw new ParseError("Must terminate " + child.syntax + " before terminating " + type, line_1, lineIx, charIx);
                sexpr = sexprs[sexprs.length - 1];
                if (!sexpr)
                    throw new ParseError("Too many closing parens", line_1, lineIx, charIx);
                sexpr.push(child);
                charIx++;
            }
            else {
                var literal = readUntilAny(line_1, [" ", ")", "]", "}"], charIx);
                var length_1 = literal.length;
                literal = utils_1.coerceInput(literal);
                var type = typeof literal === "string" ? "identifier" : "literal";
                if (!sexpr.length && type !== "identifier")
                    throw new ParseError("Expr must begin with identifier.", line_1, lineIx, charIx);
                if (type === "identifier") {
                    var dotIx = literal.indexOf(".");
                    if (dotIx !== -1) {
                        var child = new Sexpr([
                            Token.identifier("get", lineIx, charIx + 1),
                            Token.identifier(literal.slice(0, dotIx), lineIx, charIx + 3),
                            Token.string(literal.slice(dotIx + 1), lineIx, charIx + 5 + dotIx)
                        ], lineIx, charIx);
                        sexpr.push(child);
                    }
                    else
                        sexpr.push(Token.identifier(literal, lineIx, charIx));
                }
                else
                    sexpr.push(Token.literal(literal, lineIx, charIx));
                charIx += length_1;
            }
        }
        lineIx++;
    }
    if (token)
        throw new ParseError("Unterminated " + TOKEN_TYPE[token.type] + " token", lines[lineIx - 1], lineIx - 1);
    var lastIx = lines.length - 1;
    if (sexprs.length > 1)
        throw new ParseError("Too few closing parens", lines[lastIx], lastIx, lines[lastIx].length);
    return root;
}
exports.readSexprs = readSexprs;
function macroexpandDSL(sexpr) {
    // @TODO: Implement me.
    var op = sexpr.operator;
    if (op.value === "eav") {
        throw new Error("@TODO: Implement me!");
    }
    else if (op.value === "one-of") {
        // (one-of (query ...body) (query ...body) ...) =>
        // (union
        //   (def q1 (query ...body1))
        //   (def q2 (query (negate q1) ...body2)))
        throw new Error("@TODO: Implement me!");
    }
    else if (op.value === "negate") {
        if (sexpr.length > 2)
            throw new ParseError("Negate only takes a single body", undefined, sexpr.lineIx, sexpr.charIx);
        var select = macroexpandDSL(Sexpr.asSexprs(sexpr.arguments)[0]);
        select.push(Token.keyword("$$negated"));
        select.push(Token.literal(true));
        return select;
    }
    else if (["hash", "list", "get", "def", "query", "union", "select", "member", "project!", "insert!", "remove!", "load!"].indexOf(op.value) === -1) {
        // (foo-bar :a 5) => (select "foo bar" :a 5)
        var source = op;
        source.type = Token.TYPE.STRING;
        source.value = source.value.replace(/(.?)-(.)/g, "$1 $2");
        var args = sexpr.arguments;
        args.unshift(source);
        sexpr.arguments = args;
        sexpr.operator = Token.identifier("select");
    }
    return sexpr;
}
exports.macroexpandDSL = macroexpandDSL;
var VALUE;
(function (VALUE) {
    VALUE[VALUE["NULL"] = 0] = "NULL";
    VALUE[VALUE["SCALAR"] = 1] = "SCALAR";
    VALUE[VALUE["SET"] = 2] = "SET";
    VALUE[VALUE["VIEW"] = 3] = "VIEW";
})(VALUE || (VALUE = {}));
;
function parseDSL(text) {
    var artifacts = { views: {} };
    var lines = text.split("\n");
    var root = readSexprs(text);
    for (var _i = 0, _a = Sexpr.asSexprs(root.arguments); _i < _a.length; _i++) {
        var raw = _a[_i];
        parseDSLSexpr(raw, artifacts);
    }
    return artifacts;
}
exports.parseDSL = parseDSL;
function parseDSLSexpr(raw, artifacts, context, parent, resultVariable) {
    if (parent instanceof runtime.Query)
        var query = parent;
    else
        var union = parent;
    var sexpr = macroexpandDSL(raw);
    var op = sexpr.operator;
    if (op.type !== Token.TYPE.IDENTIFIER)
        throw new ParseError("Evaluated sexpr must begin with an identifier ('" + op + "' is a " + Token.TYPE[op.type] + ")", "", raw.lineIx, raw.charIx);
    if (op.value === "list") {
        var $$body = parseArguments(sexpr, undefined, "$$body").$$body;
        return { type: VALUE.SCALAR, value: $$body.map(function (token, ix) { return resolveTokenValue("list item " + ix, token, context); }) };
    }
    if (op.value === "hash") {
        var args = parseArguments(sexpr);
        for (var arg in args)
            args[arg] = resolveTokenValue("hash item " + arg, args[arg], context);
        return { type: VALUE.SET, value: args };
    }
    if (op.value === "insert!") {
        var changeset = artifacts.changeset || app_1.eve.diff();
        for (var _i = 0, _a = sexpr.arguments; _i < _a.length; _i++) {
            var arg = _a[_i];
            var table = arg.value[0];
            var fact = {};
            for (var ix = 1; ix < arg.value.length; ix += 2) {
                var key = arg.value[ix];
                var value = arg.value[ix + 1];
                fact[key.value] = value.value;
            }
            changeset.add(table.value, fact);
        }
        artifacts.changeset = changeset;
        return;
    }
    if (op.value === "remove!") {
        var changeset = artifacts.changeset || app_1.eve.diff();
        for (var _b = 0, _c = sexpr.arguments; _b < _c.length; _b++) {
            var arg = _c[_b];
            var table = arg.value[0];
            var fact = {};
            for (var ix = 1; ix < arg.value.length; ix += 2) {
                var key = arg.value[ix];
                var value = arg.value[ix + 1];
                fact[key.value] = value.value;
            }
            changeset.remove(table.value, fact);
        }
        artifacts.changeset = changeset;
        return;
    }
    if (op.value === "load!") {
        throw new Error("(load! ..) has not been implemented yet");
    }
    if (op.value === "query") {
        var neueContext = [];
        var _d = parseArguments(sexpr, undefined, "$$body"), $$view = _d.$$view, $$negated = _d.$$negated, $$body = _d.$$body;
        var queryId = $$view ? resolveTokenValue("view", $$view, context, VALUE.SCALAR) : utils_1.uuid();
        var neue = new runtime.Query(app_1.eve, queryId);
        neue["displayName"] = sexpr.toString();
        if (utils_1.DEBUG.instrumentQuery)
            instrumentQuery(neue, utils_1.DEBUG.instrumentQuery);
        artifacts.views[queryId] = neue;
        var aggregated = false;
        for (var _e = 0, _f = Sexpr.asSexprs($$body); _e < _f.length; _e++) {
            var raw_1 = _f[_e];
            var state = parseDSLSexpr(raw_1, artifacts, neueContext, neue);
            if (state && state.aggregated)
                aggregated = true;
        }
        var projectionMap = neue.projectionMap;
        var projected = true;
        if (!projectionMap) {
            projectionMap = {};
            projected = false;
            for (var _g = 0; _g < neueContext.length; _g++) {
                var variable = neueContext[_g];
                projectionMap[variable.name] = variable.value;
            }
        }
        if (Object.keys(projectionMap).length)
            neue.project(projectionMap);
        // Join subquery to parent.
        if (parent) {
            var select = new Sexpr([Token.identifier(query ? "select" : "member"), Token.string(queryId)], raw.lineIx, raw.charIx);
            var groups = [];
            for (var _h = 0; _h < neueContext.length; _h++) {
                var variable = neueContext[_h];
                if (projected && !variable.projection)
                    continue;
                var field = variable.projection || variable.name;
                select.push(Token.keyword(field));
                if (query)
                    select.push(Token.identifier(variable.name));
                else
                    select.push(Sexpr.list([Token.string(field)]));
                if (context) {
                    for (var _j = 0; _j < context.length; _j++) {
                        var parentVar = context[_j];
                        if (parentVar.name === variable.name)
                            groups.push(variable.value);
                    }
                }
            }
            if ($$negated) {
                select.push(Token.keyword("$$negated"));
                select.push($$negated);
            }
            if (groups.length && aggregated)
                neue.group(groups);
            parseDSLSexpr(select, artifacts, context, parent);
        }
        return { value: queryId, type: VALUE.VIEW, projected: projected, context: neueContext };
    }
    if (op.value === "union") {
        var _k = parseArguments(sexpr, undefined, "$$body"), $$view = _k.$$view, $$body = _k.$$body, $$negated = _k.$$negated;
        var unionId = $$view ? resolveTokenValue("view", $$view, context, VALUE.SCALAR) : utils_1.uuid();
        var neue = new runtime.Union(app_1.eve, unionId);
        if (utils_1.DEBUG.instrumentQuery)
            instrumentQuery(neue, utils_1.DEBUG.instrumentQuery);
        artifacts.views[unionId] = neue;
        var mappings = {};
        for (var _l = 0, _m = Sexpr.asSexprs($$body); _l < _m.length; _l++) {
            var raw_2 = _m[_l];
            var child = macroexpandDSL(raw_2);
            if (child.operator.value !== "query" && child.operator.value !== "union")
                throw new ParseError("Unions may only contain queries", "", raw_2.lineIx, raw_2.charIx);
            var res = parseDSLSexpr(child, artifacts, context, neue);
            for (var _o = 0, _p = res.context; _o < _p.length; _o++) {
                var variable = _p[_o];
                if (res.projected && !variable.projection)
                    continue;
                var field = variable.projection || variable.name;
                if (!mappings[field])
                    mappings[field] = {};
                mappings[field][variable.name] = true;
            }
        }
        // Join subunion to parent
        if (parent) {
            var select = new Sexpr([Token.identifier(query ? "select" : "member"), Token.string(unionId)], raw.lineIx, raw.charIx);
            for (var field in mappings) {
                var mappingVariables = Object.keys(mappings[field]);
                if (mappingVariables.length > 1)
                    throw new ParseError("All variables projected to a single union field must have the same name. Field '" + field + "' has " + mappingVariables.length + " fields (" + mappingVariables.join(", ") + ")", "", raw.lineIx, raw.charIx);
                select.push(Token.keyword(field));
                select.push(Token.identifier(mappingVariables[0]));
            }
            console.log("union select", select.toString());
            parseDSLSexpr(select, artifacts, context, parent);
        }
        return { type: VALUE.VIEW, value: unionId, mappings: mappings };
    }
    if (op.value === "member") {
        if (!union)
            throw new ParseError("Cannot add member to non-union parent", "", raw.lineIx, raw.charIx);
        var args = parseArguments(sexpr, ["$$view"]);
        var $$view = args.$$view, $$negated = args.$$negated;
        var view = resolveTokenValue("view", $$view, context, VALUE.SCALAR);
        if (view === undefined)
            throw new ParseError("Must specify a view to be unioned", "", raw.lineIx, raw.charIx);
        var join = {};
        for (var arg in args) {
            if (arg === "$$view" || arg === "$$negated")
                continue;
            join[arg] = resolveTokenValue("member field", args[arg], context);
        }
        if (runtime.QueryFunctions[view])
            throw new ParseError("Cannot union primitive view '" + view + "'", "", raw.lineIx, raw.charIx);
        union.union(view, join);
        return;
    }
    if (!parent)
        throw new ParseError("Non-query or union sexprs must be contained within a query or union", "", raw.lineIx, raw.charIx);
    if (op.value === "select") {
        if (!query)
            throw new ParseError("Cannot add select to non-query parent", "", raw.lineIx, raw.charIx);
        var selectId = utils_1.uuid();
        var $$view = getArgument(sexpr, "$$view", ["$$view"]);
        var view = resolveTokenValue("view", $$view, context, VALUE.SCALAR);
        if (view === undefined)
            throw new ParseError("Must specify a view to be selected", "", raw.lineIx, raw.charIx);
        var primitive = runtime.QueryFunctions[view];
        //@TODO: Move this to an eve table to allow user defined defaults
        var args = parseArguments(sexpr, ["$$view"].concat(getDefaults(view)));
        var $$negated = args.$$negated;
        var join = {};
        for (var arg in args) {
            var value = args[arg];
            var variable = void 0;
            if (arg === "$$view" || arg === "$$negated")
                continue;
            if (value instanceof Token && value.type !== Token.TYPE.IDENTIFIER) {
                join[arg] = args[arg].value;
                continue;
            }
            if (value instanceof Sexpr) {
                var result = parseDSLSexpr(value, artifacts, context, parent, "$$temp-" + hygienicSymbolCounter++ + "-" + arg);
                if (!result || result.type === VALUE.NULL)
                    throw new Error("Cannot set parameter '" + arg + "' to null value '" + value.toString() + "'");
                if (result.type === VALUE.VIEW) {
                    var view_1 = result.value;
                    var resultField_1 = getResult(view_1);
                    if (!resultField_1)
                        throw new Error("Cannot set parameter '" + arg + "' to select without default result field");
                    for (var _q = 0; _q < context.length; _q++) {
                        var curVar = context[_q];
                        for (var _r = 0, _s = curVar.constraints; _r < _s.length; _r++) {
                            var constraint = _s[_r];
                            if (constraint[0] === view_1 && constraint[1] === resultField_1) {
                                variable = curVar;
                                break;
                            }
                        }
                    }
                }
            }
            else
                variable = getDSLVariable(value.value, context);
            if (variable) {
                join[arg] = variable.value;
                variable.constraints.push([view, arg]);
            }
            else if ($$negated && $$negated.value)
                throw new ParseError("Cannot bind field in negated select to undefined variable '" + value.value + "'", "", raw.lineIx, raw.charIx);
            else
                context.push({ name: value.value, type: VALUE.SCALAR, value: [selectId, arg], constraints: [[view, arg]] }); // @TODO: does this not need to add to the join map?
        }
        var resultField = getResult(view);
        if (resultVariable && resultField && !join[resultField]) {
            join[resultField] = [selectId, resultField];
            context.push({ name: resultVariable, type: VALUE.SCALAR, value: [selectId, resultField], constraints: [[view, resultField]] });
        }
        if (primitive) {
            if ($$negated) {
                if (primitive.inverse)
                    view = primitive.inverse;
                else
                    throw new ParseError("Cannot invert primitive calculation '" + view + "'", "", raw.lineIx, raw.charIx);
            }
            if (primitive.aggregate)
                query.aggregate(view, join, selectId);
            else
                query.calculate(view, join, selectId);
        }
        else if ($$negated)
            query.deselect(view, join);
        else
            query.select(view, join, selectId);
        return {
            type: VALUE.VIEW,
            value: view,
            aggregated: primitive && primitive.aggregate
        };
    }
    if (op.value === "project!") {
        var args = parseArguments(sexpr, ["$$view"]);
        var $$view = args.$$view, $$negated = args.$$negated;
        var projectionMap = {};
        for (var arg in args) {
            var value = args[arg];
            if (arg === "$$view" || arg === "$$negated")
                continue;
            if (value.type !== Token.TYPE.IDENTIFIER) {
                projectionMap[arg] = args[arg].value;
                continue;
            }
            var variable = getDSLVariable(value.value, context);
            if (variable) {
                if (variable.static)
                    projectionMap[arg] = variable.value;
                else if (!$$view) {
                    variable.projection = arg;
                    projectionMap[arg] = variable.value;
                }
                else
                    projectionMap[arg] = [variable.name];
            }
            else
                throw new ParseError("Cannot bind projected field to undefined variable '" + value.value + "'", "", raw.lineIx, raw.charIx);
        }
        var view = resolveTokenValue("view", $$view, context, VALUE.SCALAR);
        if (view === undefined) {
            if (query.projectionMap)
                throw new ParseError("Query can only self-project once", "", raw.lineIx, raw.charIx);
            if ($$negated && $$negated.value)
                throw new ParseError("Cannot negate self-projection", "", raw.lineIx, raw.charIx);
            // Project self
            query.project(projectionMap);
        }
        else {
            var union_1 = artifacts.views[view] || new runtime.Union(app_1.eve, view);
            if (utils_1.DEBUG.instrumentQuery && !artifacts.views[view])
                instrumentQuery(union_1, utils_1.DEBUG.instrumentQuery);
            artifacts.views[view] = union_1;
            // if($$negated && $$negated.value) union.ununion(queryId, projectionMap);
            if ($$negated && $$negated.value)
                throw new ParseError("Union projections may not be negated in the current runtime", "", raw.lineIx, raw.charIx);
            else
                union_1.union(query.name, projectionMap);
        }
        return;
    }
    throw new ParseError("Unknown DSL operator '" + op.value + "'", "", raw.lineIx, raw.charIx);
}
function resolveTokenValue(name, token, context, type) {
    if (!token)
        return;
    if (token instanceof Sexpr)
        return parseDSLSexpr(token, undefined, context);
    if (token instanceof Token && token.type === Token.TYPE.IDENTIFIER) {
        var variable = getDSLVariable(token.value, context, VALUE.SCALAR);
        if (!variable)
            throw new Error("Cannot bind " + name + " to undefined variable '" + token.value + "'");
        if (!variable.static)
            throw new Error("Cannot bind " + name + " to dynamic variable '" + token.value + "'");
        return variable.value;
    }
    return token.value;
}
function getDSLVariable(name, context, type) {
    if (!context)
        return;
    for (var _i = 0; _i < context.length; _i++) {
        var variable = context[_i];
        if (variable.name === name) {
            if (variable.static === false)
                throw new Error("Cannot statically look up dynamic variable '" + name + "'");
            if (type !== undefined && variable.type !== type)
                throw new Error("Expected variable '" + name + "' to have type '" + type + "', but instead has type '" + variable.type + "'");
            return variable;
        }
    }
}
function getDefaults(view) {
    return (runtime.QueryFunctions[view] && runtime.QueryFunctions[view].params) || [];
}
function getResult(view) {
    return runtime.QueryFunctions[view] && runtime.QueryFunctions[view].result;
}
function getArgument(root, param, defaults) {
    var ix = 1;
    var defaultIx = 0;
    for (var ix_1 = 1, cur = root.nth(ix_1); ix_1 < root.length; ix_1++) {
        if (cur.type === Token.TYPE.KEYWORD) {
            if (cur.value === param)
                return root.nth(ix_1 + 1);
            else
                ix_1 + 1;
        }
        else {
            if (defaults && defaultIx < defaults.length) {
                var keyword = defaults[defaultIx++];
                if (keyword === param)
                    return cur;
                else
                    ix_1 + 1;
            }
            throw new Error("Param '" + param + "' not in sexpr " + root.toString());
        }
    }
    throw new Error("Param '" + param + "' not in sexpr " + root.toString());
}
exports.getArgument = getArgument;
function parseArguments(root, defaults, rest) {
    var args = {};
    var defaultIx = 0;
    var keyword;
    var kwarg = false;
    for (var _i = 0, _a = root.arguments; _i < _a.length; _i++) {
        var raw = _a[_i];
        if (raw.type === Token.TYPE.KEYWORD) {
            if (keyword)
                throw new Error("Keywords may not be values '" + raw + "'");
            else
                keyword = raw.value;
        }
        else if (keyword) {
            if (args[keyword] === undefined) {
                args[keyword] = raw;
            }
            else {
                if (!(args[keyword] instanceof Array))
                    args[keyword] = [args[keyword]];
                args[keyword].push(raw);
            }
            keyword = undefined;
            defaultIx = defaults ? defaults.length : 0;
            kwarg = true;
        }
        else if (defaults && defaultIx < defaults.length) {
            args[defaults[defaultIx++]] = raw;
        }
        else if (rest) {
            args[rest] = args[rest] || [];
            args[rest].push(raw);
        }
        else {
            if (kwarg)
                throw new Error("Cannot specify an arg after a kwarg");
            else if (defaultIx)
                throw new Error("Too many args, expected: " + defaults.length + ", got: " + (defaultIx + 1));
            else
                throw new Error("Cannot specify an arg without default keys specified");
        }
    }
    return args;
}
exports.parseArguments = parseArguments;
if (utils_1.ENV === "browser")
    window["parser"] = exports;
function instrumentQuery(q, instrument) {
    var instrumentation = instrument;
    if (!instrument || instrument === true)
        instrumentation = function (fn, args) { return console.log("*", fn, ":", args); };
    var keys = [];
    for (var key in q)
        keys.push(key);
    keys.forEach(function (fn) {
        if (!q.constructor.prototype.hasOwnProperty(fn) || typeof q[fn] !== "function")
            return;
        var old = q[fn];
        q[fn] = function () {
            instrumentation(fn, arguments);
            return old.apply(this, arguments);
        };
    });
    return q;
}
exports.instrumentQuery = instrumentQuery;
function asDiff(ixer, artifacts) {
    var views = artifacts.views;
    var diff = ixer.diff();
    for (var id in views)
        diff.merge(views[id].changeset(app_1.eve));
    return diff;
}
exports.asDiff = asDiff;
function applyAsDiffs(artifacts) {
    var views = artifacts.views;
    for (var id in views)
        app_1.eve.applyDiff(views[id].changeset(app_1.eve));
    console.log("Applied diffs for:");
    for (var id in views)
        console.log("  * ", views[id] instanceof runtime.Query ? "Query" : "Union", views[id].name);
    return artifacts;
}
exports.applyAsDiffs = applyAsDiffs;
function logArtifacts(artifacts) {
    for (var view in artifacts.views)
        console.log(view, "\n", app_1.eve.find(view));
}
exports.logArtifacts = logArtifacts;

},{"./app":9,"./runtime":15,"./utils":19}],14:[function(require,module,exports){
var microReact_1 = require("./microReact");
var utils_1 = require("./utils");
var CodeMirror = require("codemirror");
require("codemirror/mode/gfm/gfm");
require("codemirror/mode/clojure/clojure");
function replaceAll(str, find, replace) {
    var regex = new RegExp(find.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g');
    return str.replace(regex, replace);
}
function wrapWithMarkdown(cm, wrapping) {
    cm.operation(function () {
        var from = cm.getCursor("from");
        // if there's something selected wrap it
        if (cm.somethingSelected()) {
            var selected = cm.getSelection();
            var cleaned = replaceAll(selected, wrapping, "");
            if (selected.substring(0, wrapping.length) === wrapping
                && selected.substring(selected.length - wrapping.length) === wrapping) {
                cm.replaceRange(cleaned, from, cm.getCursor("to"));
                cm.setSelection(from, cm.getCursor("from"));
            }
            else {
                var str = "" + wrapping + cleaned + wrapping;
                cm.replaceRange(str, from, cm.getCursor("to"));
                cm.setSelection(from, cm.getCursor("from"));
            }
        }
        else {
            cm.replaceRange("" + wrapping + wrapping, from);
            var newLocation = { line: from.line, ch: from.ch + wrapping.length };
            cm.setCursor(newLocation);
        }
    });
}
function prefixWithMarkdown(cm, prefix) {
    cm.operation(function () {
        var from = cm.getCursor("from");
        var to = cm.getCursor("to");
        var toPrefix = [];
        for (var lineIx = from.line; lineIx <= to.line; lineIx++) {
            var currentPrefix = cm.getRange({ line: lineIx, ch: 0 }, { line: lineIx, ch: prefix.length });
            if (currentPrefix !== prefix && currentPrefix !== "") {
                toPrefix.push(lineIx);
            }
        }
        // if everything in the selection has been prefixed, then we need to unprefix
        if (toPrefix.length === 0) {
            for (var lineIx = from.line; lineIx <= to.line; lineIx++) {
                cm.replaceRange("", { line: lineIx, ch: 0 }, { line: lineIx, ch: prefix.length });
            }
        }
        else {
            for (var _i = 0; _i < toPrefix.length; _i++) {
                var lineIx = toPrefix[_i];
                cm.replaceRange(prefix, { line: lineIx, ch: 0 });
            }
        }
    });
}
var defaultKeys = {
    "Cmd-B": function (cm) {
        wrapWithMarkdown(cm, "**");
    },
    "Cmd-I": function (cm) {
        wrapWithMarkdown(cm, "_");
    },
};
var RichTextEditor = (function () {
    function RichTextEditor(node, options) {
        //format bar
        this.formatBarDelay = 100;
        this.showingFormatBar = false;
        this.formatBarElement = null;
        this.marks = {};
        this.meta = {};
        var extraKeys = utils_1.mergeObject(utils_1.copy(defaultKeys), options.keys || {});
        this.cmInstance = CodeMirror(node, {
            mode: "eve",
            lineWrapping: true,
            autoCloseBrackets: true,
            viewportMargin: Infinity,
            extraKeys: extraKeys
        });
        var cm = this.cmInstance;
        var self = this;
        cm.on("changes", function (cm, changes) {
            self.onChanges(cm, changes);
            if (self.onUpdate) {
                self.onUpdate(self.meta, cm.getValue());
            }
        });
        cm.on("cursorActivity", function (cm) { self.onCursorActivity(cm); });
        cm.on("mousedown", function (cm, e) { self.onMouseDown(cm, e); });
        cm.getWrapperElement().addEventListener("mouseup", function (e) {
            self.onMouseUp(cm, e);
        });
    }
    RichTextEditor.prototype.showFormatBar = function () {
        //@ TODO: re-enable the format bar
        return;
        this.showingFormatBar = true;
        var renderer = new microReact_1.Renderer();
        var cm = this.cmInstance;
        var head = cm.getCursor("head");
        var from = cm.getCursor("from");
        var to = cm.getCursor("to");
        var start = cm.cursorCoords(head, "local");
        var top = start.bottom + 5;
        if ((head.line === from.line && head.ch === from.ch)
            || (cm.cursorCoords(from, "local").top === cm.cursorCoords(to, "local").top)) {
            top = start.top - 40;
        }
        var barSize = 300 / 2;
        var item = { c: "formatBar", style: "position:absolute; left: " + (start.left - barSize) + "px; top:" + top + "px;", children: [
                { c: "button ", text: "H1", click: function () { prefixWithMarkdown(cm, "# "); } },
                { c: "button ", text: "H2", click: function () { prefixWithMarkdown(cm, "## "); } },
                { c: "sep" },
                { c: "button bold", text: "B", click: function () { wrapWithMarkdown(cm, "**"); } },
                { c: "button italic", text: "I", click: function () { wrapWithMarkdown(cm, "_"); } },
                { c: "sep" },
                { c: "button ", text: "-", click: function () { prefixWithMarkdown(cm, "- "); } },
                { c: "button ", text: "1.", click: function () { prefixWithMarkdown(cm, "1. "); } },
                { c: "button ", text: "[ ]", click: function () { prefixWithMarkdown(cm, "[ ] "); } },
                { c: "sep" },
                { c: "button ", text: "link" },
            ] };
        renderer.render([item]);
        var elem = renderer.content.firstChild;
        this.formatBarElement = elem;
        cm.getWrapperElement().appendChild(elem);
        // this.cmInstance.addWidget(pos, elem);
    };
    RichTextEditor.prototype.hideFormatBar = function () {
        this.showingFormatBar = false;
        this.formatBarElement.parentNode.removeChild(this.formatBarElement);
        this.formatBarElement = null;
    };
    RichTextEditor.prototype.onChanges = function (cm, changes) {
        var self = this;
    };
    RichTextEditor.prototype.onCursorActivity = function (cm) {
        if (this.showingFormatBar && !cm.somethingSelected()) {
            this.hideFormatBar();
        }
    };
    RichTextEditor.prototype.onMouseUp = function (cm, e) {
        if (!this.showingFormatBar) {
            var self = this;
            clearTimeout(this.timeout);
            this.timeout = setTimeout(function () {
                if (cm.somethingSelected()) {
                    self.showFormatBar();
                }
            }, this.formatBarDelay);
        }
    };
    RichTextEditor.prototype.onMouseDown = function (cm, e) {
        var cursor = cm.coordsChar({ left: e.clientX, top: e.clientY });
        var pos = cm.indexFromPos(cursor);
        var marks = cm.findMarksAt(cursor);
    };
    RichTextEditor.prototype.addMark = function (paneId, cell, from, to, mark) {
        var cm = this.cmInstance;
        var cellId = cell.id;
        var dom;
        if (!mark) {
            dom = document.createElement("div");
            dom.id = paneId + "|" + cellId + "|container";
        }
        else {
            dom = mark.replacedWith;
            mark.clear();
        }
        var newMark = cm.markText(cm.posFromIndex(from), cm.posFromIndex(to), { replacedWith: dom });
        newMark.cell = cell;
        dom["mark"] = newMark;
        this.marks[cellId] = newMark;
    };
    return RichTextEditor;
})();
exports.RichTextEditor = RichTextEditor;
function createEditor(node, elem) {
    var options = elem.options || {};
    var editor = node.editor;
    var cm;
    if (!editor) {
        editor = node.editor = new RichTextEditor(node, options);
        cm = node.editor.cmInstance;
        if (!options.noFocus) {
            cm.focus();
        }
        cm.refresh(); // @FIXME: This also needs to be called any time it is hidden and added again.
    }
    else {
        cm = node.editor.cmInstance;
    }
    editor.onUpdate = elem.onUpdate;
    editor.meta = elem.meta || editor.meta;
    var doc = cm.getDoc();
    if (doc.getValue() !== elem.value) {
        doc.setValue(elem.value || "");
        doc.clearHistory();
    }
    if (elem.cells) {
        cm.operation(function () {
            var cellIds = {};
            for (var _i = 0, _a = elem.cells; _i < _a.length; _i++) {
                var cell = _a[_i];
                cellIds[cell.id] = true;
                var mark = editor.marks[cell.id];
                var add = false;
                if (!mark) {
                    add = true;
                }
                else {
                    var found = mark.find();
                    if (!found) {
                        add = true;
                    }
                    else {
                        // if the mark doesn't contain the correct text, we need to nuke it.
                        var from = found.from, to = found.to;
                        if (cm.getRange(from, to) !== cell.value || cell.start !== cm.indexFromPos(from)) {
                            add = true;
                        }
                    }
                }
                if (add) {
                    editor.addMark(elem["meta"].paneId, cell, cell.start, cell.start + cell.length, mark);
                }
            }
            for (var markId in editor.marks) {
                if (!cellIds[markId]) {
                    editor.marks[markId].clear();
                    delete editor.marks[markId];
                }
            }
        });
    }
}
exports.createEditor = createEditor;
CodeMirror.defineMode("eve", function () {
    return {
        startState: function () {
            return {};
        },
        token: function (stream, state) {
            if (stream.sol() && stream.peek() === "#") {
                state.header = true;
                stream.eatWhile("#");
                state.headerNum = stream.current().length;
                return "header-indicator header-indicator-" + state.headerNum;
            }
            else if (state.header) {
                stream.skipToEnd();
                state.header = false;
                return "header header-" + state.headerNum;
            }
            else {
                state.header = false;
                stream.skipToEnd();
            }
        }
    };
});
CodeMirror.defineMIME("text/x-eve", "eve");

},{"./microReact":12,"./utils":19,"codemirror":2,"codemirror/mode/clojure/clojure":3,"codemirror/mode/gfm/gfm":4}],15:[function(require,module,exports){
var utils_1 = require("./utils");
var runtime = exports;
exports.MAX_NUMBER = 9007199254740991;
exports.INCREMENTAL = false;
function objectsIdentical(a, b) {
    var aKeys = Object.keys(a);
    for (var _i = 0; _i < aKeys.length; _i++) {
        var key = aKeys[_i];
        //TODO: handle non-scalar values
        if (a[key] !== b[key])
            return false;
    }
    return true;
}
function indexOfFact(haystack, needle) {
    var ix = 0;
    for (var _i = 0; _i < haystack.length; _i++) {
        var fact = haystack[_i];
        if (fact.__id === needle.__id) {
            return ix;
        }
        ix++;
    }
    return -1;
}
function removeFact(haystack, needle) {
    var ix = indexOfFact(haystack, needle);
    if (ix > -1)
        haystack.splice(ix, 1);
    return haystack;
}
exports.removeFact = removeFact;
function diffAddsAndRemoves(adds, removes) {
    var localHash = {};
    var hashToFact = {};
    var hashes = [];
    for (var _i = 0; _i < adds.length; _i++) {
        var add = adds[_i];
        var hash = add.__id;
        if (localHash[hash] === undefined) {
            localHash[hash] = 1;
            hashToFact[hash] = add;
            hashes.push(hash);
        }
        else {
            localHash[hash]++;
        }
        add.__id = hash;
    }
    for (var _a = 0; _a < removes.length; _a++) {
        var remove = removes[_a];
        var hash = remove.__id;
        if (localHash[hash] === undefined) {
            localHash[hash] = -1;
            hashToFact[hash] = remove;
            hashes.push(hash);
        }
        else {
            localHash[hash]--;
        }
        remove.__id = hash;
    }
    var realAdds = [];
    var realRemoves = [];
    for (var _b = 0; _b < hashes.length; _b++) {
        var hash = hashes[_b];
        var count = localHash[hash];
        if (count > 0) {
            var fact = hashToFact[hash];
            realAdds.push(fact);
        }
        else if (count < 0) {
            var fact = hashToFact[hash];
            realRemoves.push(fact);
        }
    }
    return { adds: realAdds, removes: realRemoves };
}
function generateEqualityFn(keys) {
    return new Function("a", "b", "return " + keys.map(function (key, ix) {
        if (key.constructor === Array) {
            return "a['" + key[0] + "']['" + key[1] + "'] === b['" + key[0] + "']['" + key[1] + "']";
        }
        else {
            return "a[\"" + key + "\"] === b[\"" + key + "\"]";
        }
    }).join(" && ") + ";");
}
function generateStringFn(keys) {
    var keyStrings = [];
    for (var _i = 0; _i < keys.length; _i++) {
        var key = keys[_i];
        if (key.constructor === Array) {
            keyStrings.push("a['" + key[0] + "']['" + key[1] + "']");
        }
        else {
            keyStrings.push("a['" + key + "']");
        }
    }
    var final = keyStrings.join(' + "|" + ');
    return new Function("a", "return " + final + ";");
}
function generateUnprojectedSorterCode(unprojectedSize, sorts) {
    var conditions = [];
    var path = [];
    var distance = unprojectedSize;
    for (var _i = 0; _i < sorts.length; _i++) {
        var sort = sorts[_i];
        var condition = "";
        for (var _a = 0; _a < path.length; _a++) {
            var prev = path[_a];
            var table_1 = prev[0], key_1 = prev[1];
            condition += "unprojected[j-" + (distance - table_1) + "]['" + key_1 + "'] === item" + table_1 + "['" + key_1 + "'] && ";
        }
        var table = sort[0], key = sort[1], dir = sort[2];
        var op = ">";
        if (dir === "descending") {
            op = "<";
        }
        condition += "unprojected[j-" + (distance - table) + "]['" + key + "'] " + op + " item" + table + "['" + key + "']";
        conditions.push(condition);
        path.push(sort);
    }
    var items = [];
    var repositioned = [];
    var itemAssignments = [];
    for (var ix = 0; ix < distance; ix++) {
        items.push("item" + ix + " = unprojected[j+" + ix + "]");
        repositioned.push("unprojected[j+" + ix + "] = unprojected[j - " + (distance - ix) + "]");
        itemAssignments.push(("unprojected[j+" + ix + "] = item" + ix));
    }
    return "for (var i = 0, len = unprojected.length; i < len; i += " + distance + ") {\n      var j = i, " + items.join(", ") + ";\n      for(; j > " + (distance - 1) + " && (" + conditions.join(" || ") + "); j -= " + distance + ") {\n        " + repositioned.join(";\n") + "\n      }\n      " + itemAssignments.join(";\n") + "\n  }";
}
function generateCollector(keys) {
    var code = "var runtime = this;\n";
    var ix = 0;
    var checks = "";
    var removes = "var cur = index";
    for (var _i = 0; _i < keys.length; _i++) {
        var key = keys[_i];
        if (key.constructor === Array) {
            removes += "[remove['" + key[0] + "']['" + key[1] + "']]";
        }
        else {
            removes += "[remove['" + key + "']]";
        }
    }
    removes += ";\nruntime.removeFact(cur, remove);";
    for (var _a = 0; _a < keys.length; _a++) {
        var key = keys[_a];
        ix++;
        if (key.constructor === Array) {
            checks += "value = add['" + key[0] + "']['" + key[1] + "']\n";
        }
        else {
            checks += "value = add['" + key + "']\n";
        }
        var path = "cursor[value]";
        checks += "if(!" + path + ") " + path + " = ";
        if (ix === keys.length) {
            checks += "[]\n";
        }
        else {
            checks += "{}\n";
        }
        checks += "cursor = " + path + "\n";
    }
    code += "\nfor(var ix = 0, len = removes.length; ix < len; ix++) {\nvar remove = removes[ix];\n" + removes + "\n}\nfor(var ix = 0, len = adds.length; ix < len; ix++) {\nvar add = adds[ix];\nvar cursor = index;\nvar value;\n" + checks + "  cursor.push(add);\n}\nreturn index;";
    return (new Function("index", "adds", "removes", code)).bind(runtime);
}
function generateCollector2(keys) {
    var hashParts = [];
    for (var _i = 0; _i < keys.length; _i++) {
        var key = keys[_i];
        if (key.constructor === Array) {
            hashParts.push("add['" + key[0] + "']['" + key[1] + "']");
        }
        else {
            hashParts.push("add['" + key + "']");
        }
    }
    var code = "\n    var ixCache = cache.ix;\n    var idCache = cache.id;\n    for(var ix = 0, len = removes.length; ix < len; ix++) {\n      var remove = removes[ix];\n      var id = remove.__id;\n      var key = idCache[id];\n      var factIx = ixCache[id];\n      var facts = index[key];\n      //swap the last fact with this one to prevent holes\n      var lastFact = facts.pop();\n      if(lastFact && lastFact.__id !== remove.__id) {\n        facts[factIx] = lastFact;\n        ixCache[lastFact.__id] = factIx;\n      } else if(facts.length === 0) {\n        delete index[key];\n      }\n      delete idCache[id];\n      delete ixCache[id];\n    }\n    for(var ix = 0, len = adds.length; ix < len; ix++) {\n      var add = adds[ix];\n      var id = add.__id;\n      var key = idCache[id] = " + hashParts.join(" + '|' + ") + ";\n      if(index[key] === undefined) index[key] = [];\n      var arr = index[key];\n      ixCache[id] = arr.length;\n      arr.push(add);\n    }\n    return index;";
    return new Function("index", "adds", "removes", "cache", code);
}
function mergeArrays(as, bs) {
    var ix = as.length;
    var start = ix;
    for (var _i = 0; _i < bs.length; _i++) {
        var b = bs[_i];
        as[ix] = bs[ix - start];
        ix++;
    }
    return as;
}
var Diff = (function () {
    function Diff(ixer) {
        this.ixer = ixer;
        this.tables = {};
        this.length = 0;
        this.meta = {};
    }
    Diff.prototype.ensureTable = function (table) {
        var tableDiff = this.tables[table];
        if (!tableDiff) {
            tableDiff = this.tables[table] = { adds: [], removes: [] };
        }
        return tableDiff;
    };
    Diff.prototype.add = function (table, obj) {
        var tableDiff = this.ensureTable(table);
        this.length++;
        tableDiff.adds.push(obj);
        return this;
    };
    Diff.prototype.addMany = function (table, objs) {
        var tableDiff = this.ensureTable(table);
        this.length += objs.length;
        mergeArrays(tableDiff.adds, objs);
        return this;
    };
    Diff.prototype.removeFacts = function (table, objs) {
        var tableDiff = this.ensureTable(table);
        this.length += objs.length;
        mergeArrays(tableDiff.removes, objs);
        return this;
    };
    Diff.prototype.remove = function (table, query) {
        var tableDiff = this.ensureTable(table);
        var found = this.ixer.find(table, query);
        this.length += found.length;
        mergeArrays(tableDiff.removes, found);
        return this;
    };
    Diff.prototype.merge = function (diff) {
        for (var table in diff.tables) {
            var tableDiff = diff.tables[table];
            this.addMany(table, tableDiff.adds);
            this.removeFacts(table, tableDiff.removes);
        }
        return this;
    };
    Diff.prototype.reverse = function () {
        var reversed = new Diff(this.ixer);
        for (var table in this.tables) {
            var diff = this.tables[table];
            reversed.addMany(table, diff.removes);
            reversed.removeFacts(table, diff.adds);
        }
        return reversed;
    };
    return Diff;
})();
exports.Diff = Diff;
var Indexer = (function () {
    function Indexer() {
        this.tables = {};
        this.globalCount = 0;
        this.edbTables = {};
    }
    Indexer.prototype.addTable = function (name, keys) {
        if (keys === void 0) { keys = []; }
        var table = this.tables[name];
        keys = keys.filter(function (key) { return key !== "__id"; });
        if (table && keys.length) {
            table.fields = keys;
            table.stringify = generateStringFn(keys);
        }
        else {
            table = this.tables[name] = { table: [], hashToIx: {}, factHash: {}, indexes: {}, triggers: {}, fields: keys, stringify: generateStringFn(keys), keyLookup: {} };
            this.edbTables[name] = true;
        }
        for (var _i = 0; _i < keys.length; _i++) {
            var key = keys[_i];
            if (key.constructor === Array) {
                table.keyLookup[key[0]] = key;
            }
            else {
                table.keyLookup[key] = key;
            }
        }
        return table;
    };
    Indexer.prototype.clearTable = function (name) {
        var table = this.tables[name];
        if (!table)
            return;
        table.table = [];
        table.factHash = {};
        for (var indexName in table.indexes) {
            table.indexes[indexName].index = {};
            table.indexes[indexName].cache = { id: {}, ix: {} };
        }
    };
    Indexer.prototype.updateTable = function (tableId, adds, removes) {
        var table = this.tables[tableId];
        if (!table || !table.fields.length) {
            var example = adds[0] || removes[0];
            table = this.addTable(tableId, Object.keys(example));
        }
        var stringify = table.stringify;
        var facts = table.table;
        var factHash = table.factHash;
        var hashToIx = table.hashToIx;
        var localHash = {};
        var hashToFact = {};
        var hashes = [];
        for (var _i = 0; _i < adds.length; _i++) {
            var add = adds[_i];
            var hash = add.__id || stringify(add);
            if (localHash[hash] === undefined) {
                localHash[hash] = 1;
                hashToFact[hash] = add;
                hashes.push(hash);
            }
            else {
                localHash[hash]++;
            }
            add.__id = hash;
        }
        for (var _a = 0; _a < removes.length; _a++) {
            var remove = removes[_a];
            var hash = remove.__id || stringify(remove);
            if (localHash[hash] === undefined) {
                localHash[hash] = -1;
                hashToFact[hash] = remove;
                hashes.push(hash);
            }
            else {
                localHash[hash]--;
            }
            remove.__id = hash;
        }
        var realAdds = [];
        var realRemoves = [];
        for (var _b = 0; _b < hashes.length; _b++) {
            var hash = hashes[_b];
            var count = localHash[hash];
            if (count > 0 && !factHash[hash]) {
                var fact = hashToFact[hash];
                realAdds.push(fact);
                facts.push(fact);
                factHash[hash] = fact;
                hashToIx[hash] = facts.length - 1;
            }
            else if (count < 0 && factHash[hash]) {
                var fact = hashToFact[hash];
                var ix = hashToIx[hash];
                //swap the last fact with this one to prevent holes
                var lastFact = facts.pop();
                if (lastFact && lastFact.__id !== fact.__id) {
                    facts[ix] = lastFact;
                    hashToIx[lastFact.__id] = ix;
                }
                realRemoves.push(fact);
                delete factHash[hash];
                delete hashToIx[hash];
            }
        }
        return { adds: realAdds, removes: realRemoves };
    };
    Indexer.prototype.collector = function (keys) {
        return {
            index: {},
            cache: { id: {}, ix: {} },
            hasher: generateStringFn(keys),
            collect: generateCollector2(keys),
        };
    };
    Indexer.prototype.factToIndex = function (table, fact) {
        var keys = Object.keys(fact);
        if (!keys.length)
            return table.table.slice();
        var index = this.index(table, keys);
        var result = index.index[index.hasher(fact)];
        if (result) {
            return result.slice();
        }
        return [];
    };
    Indexer.prototype.execDiff = function (diff) {
        var triggers = {};
        var realDiffs = {};
        var tableIds = Object.keys(diff.tables);
        for (var _i = 0; _i < tableIds.length; _i++) {
            var tableId = tableIds[_i];
            var tableDiff = diff.tables[tableId];
            if (tableDiff.adds.length === 0 && tableDiff.removes.length === 0)
                continue;
            var realDiff = this.updateTable(tableId, tableDiff.adds, tableDiff.removes);
            // go through all the indexes and update them.
            var table = this.tables[tableId];
            var indexes = Object.keys(table.indexes);
            for (var _a = 0; _a < indexes.length; _a++) {
                var indexName = indexes[_a];
                var index = table.indexes[indexName];
                index.collect(index.index, realDiff.adds, realDiff.removes, index.cache);
            }
            var curTriggers = Object.keys(table.triggers);
            for (var _b = 0; _b < curTriggers.length; _b++) {
                var triggerName = curTriggers[_b];
                var trigger = table.triggers[triggerName];
                triggers[triggerName] = trigger;
            }
            realDiffs[tableId] = realDiff;
        }
        return { triggers: triggers, realDiffs: realDiffs };
    };
    Indexer.prototype.execTrigger = function (trigger) {
        var table = this.table(trigger.name);
        // since views might be changed during the triggering process, we want to favor
        // just using the view itself as the trigger if it is one. Otherwise, we use the
        // trigger's exec function. This ensures that if a view is recompiled and added
        // that any already queued triggers will use the updated version of the view instead
        // of the old queued one.
        var _a = (table.view ? table.view.exec() : trigger.exec(this)) || {}, _b = _a.results, results = _b === void 0 ? undefined : _b, _c = _a.unprojected, unprojected = _c === void 0 ? undefined : _c;
        if (!results)
            return;
        var prevResults = table.factHash;
        var prevHashes = Object.keys(prevResults);
        table.unprojected = unprojected;
        if (results) {
            var diff = new Diff(this);
            this.clearTable(trigger.name);
            diff.addMany(trigger.name, results);
            var triggers = this.execDiff(diff).triggers;
            var newHashes = table.factHash;
            if (prevHashes.length === Object.keys(newHashes).length) {
                var same = true;
                for (var _i = 0; _i < prevHashes.length; _i++) {
                    var hash = prevHashes[_i];
                    if (!newHashes[hash]) {
                        same = false;
                        break;
                    }
                }
                return same ? undefined : triggers;
            }
            else {
                return triggers;
            }
        }
        return;
    };
    Indexer.prototype.transitivelyClearTriggers = function (startingTriggers) {
        var cleared = {};
        var remaining = Object.keys(startingTriggers);
        for (var ix = 0; ix < remaining.length; ix++) {
            var trigger = remaining[ix];
            if (cleared[trigger])
                continue;
            this.clearTable(trigger);
            cleared[trigger] = true;
            remaining.push.apply(remaining, Object.keys(this.table(trigger).triggers));
        }
        return cleared;
    };
    Indexer.prototype.execTriggers = function (triggers) {
        var newTriggers = {};
        var retrigger = false;
        for (var triggerName in triggers) {
            // console.log("Calling:", triggerName);
            var trigger = triggers[triggerName];
            var nextRound = this.execTrigger(trigger);
            if (nextRound) {
                retrigger = true;
                for (var trigger_1 in nextRound) {
                    // console.log("Queuing:", trigger);
                    newTriggers[trigger_1] = nextRound[trigger_1];
                }
            }
        }
        if (retrigger) {
            return newTriggers;
        }
    };
    //---------------------------------------------------------
    // Indexer Public API
    //---------------------------------------------------------
    Indexer.prototype.serialize = function (asObject) {
        var dump = {};
        for (var tableName in this.tables) {
            var table = this.tables[tableName];
            if (!table.isView) {
                dump[tableName] = table.table;
            }
        }
        if (asObject) {
            return dump;
        }
        return JSON.stringify(dump);
    };
    Indexer.prototype.load = function (serialized) {
        var dump = JSON.parse(serialized);
        var diff = this.diff();
        for (var tableName in dump) {
            diff.addMany(tableName, dump[tableName]);
        }
        if (exports.INCREMENTAL) {
            this.applyDiffIncremental(diff);
        }
        else {
            this.applyDiff(diff);
        }
    };
    Indexer.prototype.diff = function () {
        return new Diff(this);
    };
    Indexer.prototype.applyDiff = function (diff) {
        if (exports.INCREMENTAL) {
            return this.applyDiffIncremental(diff);
        }
        var _a = this.execDiff(diff), triggers = _a.triggers, realDiffs = _a.realDiffs;
        var cleared;
        var round = 0;
        if (triggers)
            cleared = this.transitivelyClearTriggers(triggers);
        while (triggers) {
            for (var trigger in triggers) {
                cleared[trigger] = false;
            }
            // console.group(`ROUND ${round}`);
            triggers = this.execTriggers(triggers);
            round++;
        }
        for (var _i = 0, _b = Object.keys(cleared); _i < _b.length; _i++) {
            var trigger = _b[_i];
            if (!cleared[trigger])
                continue;
            var view = this.table(trigger).view;
            if (view) {
                this.execTrigger(view);
            }
        }
    };
    Indexer.prototype.table = function (tableId) {
        var table = this.tables[tableId];
        if (table)
            return table;
        return this.addTable(tableId);
    };
    Indexer.prototype.index = function (tableOrId, keys) {
        var table;
        if (typeof tableOrId === "string")
            table = this.table(tableOrId);
        else
            table = tableOrId;
        keys.sort();
        var indexName = keys.filter(function (key) { return key !== "__id"; }).join("|");
        var index = table.indexes[indexName];
        if (!index) {
            var tableKeys = [];
            for (var _i = 0; _i < keys.length; _i++) {
                var key = keys[_i];
                tableKeys.push(table.keyLookup[key] || key);
            }
            index = table.indexes[indexName] = this.collector(tableKeys);
            index.collect(index.index, table.table, [], index.cache);
        }
        return index;
    };
    Indexer.prototype.find = function (tableId, query) {
        var table = this.tables[tableId];
        if (!table) {
            return [];
        }
        else if (!query) {
            return table.table.slice();
        }
        else {
            return this.factToIndex(table, query);
        }
    };
    Indexer.prototype.findOne = function (tableId, query) {
        return this.find(tableId, query)[0];
    };
    Indexer.prototype.query = function (name) {
        if (name === void 0) { name = "unknown"; }
        return new Query(this, name);
    };
    Indexer.prototype.union = function (name) {
        return new Union(this, name);
    };
    Indexer.prototype.trigger = function (name, table, exec, execIncremental) {
        var tables = (typeof table === "string") ? [table] : table;
        var trigger = { name: name, tables: tables, exec: exec, execIncremental: execIncremental };
        for (var _i = 0; _i < tables.length; _i++) {
            var tableId = tables[_i];
            var table_2 = this.table(tableId);
            table_2.triggers[name] = trigger;
        }
        if (!exports.INCREMENTAL) {
            var nextRound = this.execTrigger(trigger);
            while (nextRound) {
                nextRound = this.execTriggers(nextRound);
            }
            ;
        }
        else {
            if (!tables.length) {
                return exec(this);
            }
            var initial = (_a = {}, _a[tables[0]] = { adds: this.tables[tables[0]].table, removes: [] }, _a);
            var _b = this.execTriggerIncremental(trigger, initial), triggers = _b.triggers, changes = _b.changes;
            while (triggers) {
                var results = this.execTriggersIncremental(triggers, changes);
                if (!results)
                    break;
                triggers = results.triggers;
                changes = results.changes;
            }
        }
        var _a;
    };
    Indexer.prototype.asView = function (query) {
        var name = query.name;
        if (this.tables[name]) {
            this.removeView(name);
        }
        var view = this.table(name);
        this.edbTables[name] = false;
        view.view = query;
        view.isView = true;
        this.trigger(name, query.tables, query.exec.bind(query), query.execIncremental.bind(query));
    };
    Indexer.prototype.removeView = function (id) {
        for (var _i = 0, _a = this.tables; _i < _a.length; _i++) {
            var table = _a[_i];
            delete table.triggers[id];
        }
    };
    Indexer.prototype.totalFacts = function () {
        var total = 0;
        for (var tableName in this.tables) {
            total += this.tables[tableName].table.length;
        }
        return total;
    };
    Indexer.prototype.factsPerTable = function () {
        var info = {};
        for (var tableName in this.tables) {
            info[tableName] = this.tables[tableName].table.length;
        }
        return info;
    };
    Indexer.prototype.applyDiffIncremental = function (diff) {
        if (diff.length === 0)
            return;
        // console.log("DIFF SIZE: ", diff.length, diff);
        var _a = this.execDiff(diff), triggers = _a.triggers, realDiffs = _a.realDiffs;
        var round = 0;
        var changes = realDiffs;
        while (triggers) {
            // console.group(`ROUND ${round}`);
            // console.log("CHANGES: ", changes);
            var results = this.execTriggersIncremental(triggers, changes);
            // console.groupEnd();
            if (!results)
                break;
            triggers = results.triggers;
            changes = results.changes;
            round++;
        }
    };
    Indexer.prototype.execTriggerIncremental = function (trigger, changes) {
        var table = this.table(trigger.name);
        var adds, provenance, removes, info;
        if (trigger.execIncremental) {
            info = trigger.execIncremental(changes, table) || {};
            adds = info.adds;
            removes = info.removes;
        }
        else {
            trigger.exec();
            return;
        }
        var diff = new runtime.Diff(this);
        if (adds.length) {
            diff.addMany(trigger.name, adds);
        }
        if (removes.length) {
            diff.removeFacts(trigger.name, removes);
        }
        var updated = this.execDiff(diff);
        var realDiffs = updated.realDiffs;
        if (realDiffs[trigger.name] && (realDiffs[trigger.name].adds.length || realDiffs[trigger.name].removes)) {
            return { changes: realDiffs[trigger.name], triggers: updated.triggers };
        }
        else {
            return {};
        }
    };
    Indexer.prototype.execTriggersIncremental = function (triggers, changes) {
        var newTriggers = {};
        var nextChanges = {};
        var retrigger = false;
        var triggerKeys = Object.keys(triggers);
        for (var _i = 0; _i < triggerKeys.length; _i++) {
            var triggerName = triggerKeys[_i];
            // console.log("Calling:", triggerName);
            var trigger = triggers[triggerName];
            var nextRound = this.execTriggerIncremental(trigger, changes);
            if (nextRound && nextRound.changes) {
                nextChanges[triggerName] = nextRound.changes;
                if (nextRound.triggers) {
                    var nextRoundKeys = Object.keys(nextRound.triggers);
                    for (var _a = 0; _a < nextRoundKeys.length; _a++) {
                        var trigger_2 = nextRoundKeys[_a];
                        if (trigger_2 && nextRound.triggers[trigger_2]) {
                            retrigger = true;
                            // console.log("Queuing:", trigger);
                            newTriggers[trigger_2] = nextRound.triggers[trigger_2];
                        }
                    }
                }
            }
        }
        if (retrigger) {
            return { changes: nextChanges, triggers: newTriggers };
        }
    };
    return Indexer;
})();
exports.Indexer = Indexer;
function addProvenanceTable(ixer) {
    var table = ixer.addTable("provenance", ["table", ["row", "__id"], "row instance", "source", ["source row", "__id"]]);
    // generate some indexes that we know we're going to need upfront
    ixer.index("provenance", ["table", "row"]);
    ixer.index("provenance", ["table", "row instance"]);
    ixer.index("provenance", ["table", "source", "source row"]);
    ixer.index("provenance", ["table"]);
    return ixer;
}
exports.addProvenanceTable = addProvenanceTable;
function mappingToDiff(diff, action, mapping, aliases, reverseLookup) {
    for (var from in mapping) {
        var to = mapping[from];
        if (to.constructor === Array) {
            var source = to[0];
            if (typeof source === "number") {
                source = aliases[reverseLookup[source]];
            }
            else {
                source = aliases[source];
            }
            diff.add("action mapping", { action: action, from: from, "to source": source, "to field": to[1] });
        }
        else {
            diff.add("action mapping constant", { action: action, from: from, value: to });
        }
    }
    return diff;
}
exports.QueryFunctions = {};
var STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg;
var ARGUMENT_NAMES = /([^\s,]+)/g;
function getParamNames(func) {
    var fnStr = func.toString().replace(STRIP_COMMENTS, '');
    var result = fnStr.slice(fnStr.indexOf('(') + 1, fnStr.indexOf(')')).match(ARGUMENT_NAMES);
    if (result === null)
        result = [];
    return result;
}
function define(name, opts, func) {
    var params = getParamNames(func);
    opts.name = name;
    opts.params = params;
    opts.func = func;
    exports.QueryFunctions[name] = opts;
}
exports.define = define;
var Query = (function () {
    function Query(ixer, name) {
        if (name === void 0) { name = "unknown"; }
        this.name = name;
        this.ixer = ixer;
        this.dirty = true;
        this.tables = [];
        this.joins = [];
        this.aliases = {};
        this.funcs = [];
        this.aggregates = [];
        this.unprojectedSize = 0;
        this.hasOrdinal = false;
    }
    Query.remove = function (view, ixer) {
        var diff = ixer.diff();
        diff.remove("view", { view: view });
        for (var _i = 0, _a = ixer.find("action", { view: view }); _i < _a.length; _i++) {
            var actionItem = _a[_i];
            var action = actionItem.action;
            diff.remove("action", { action: action });
            diff.remove("action source", { action: action });
            diff.remove("action mapping", { action: action });
            diff.remove("action mapping constant", { action: action });
            diff.remove("action mapping sorted", { action: action });
            diff.remove("action mapping limit", { action: action });
        }
        return diff;
    };
    Query.prototype.changeset = function (ixer) {
        var diff = ixer.diff();
        var aliases = {};
        var reverseLookup = {};
        for (var alias in this.aliases) {
            reverseLookup[this.aliases[alias]] = alias;
        }
        var view = this.name;
        diff.add("view", { view: view, kind: "query" });
        //joins
        for (var _i = 0, _a = this.joins; _i < _a.length; _i++) {
            var join = _a[_i];
            var action = utils_1.uuid();
            aliases[join.as] = action;
            if (!join.negated) {
                diff.add("action", { view: view, action: action, kind: "select", ix: join.ix });
            }
            else {
                diff.add("action", { view: view, action: action, kind: "deselect", ix: join.ix });
            }
            diff.add("action source", { action: action, "source view": join.table });
            mappingToDiff(diff, action, join.join, aliases, reverseLookup);
        }
        //functions
        for (var _b = 0, _c = this.funcs; _b < _c.length; _b++) {
            var func = _c[_b];
            var action = utils_1.uuid();
            aliases[func.as] = action;
            diff.add("action", { view: view, action: action, kind: "calculate", ix: func.ix });
            diff.add("action source", { action: action, "source view": func.name });
            mappingToDiff(diff, action, func.args, aliases, reverseLookup);
        }
        //aggregates
        for (var _d = 0, _e = this.aggregates; _d < _e.length; _d++) {
            var agg = _e[_d];
            var action = utils_1.uuid();
            aliases[agg.as] = action;
            diff.add("action", { view: view, action: action, kind: "aggregate", ix: agg.ix });
            diff.add("action source", { action: action, "source view": agg.name });
            mappingToDiff(diff, action, agg.args, aliases, reverseLookup);
        }
        //sort
        if (this.sorts) {
            var action = utils_1.uuid();
            diff.add("action", { view: view, action: action, kind: "sort", ix: exports.MAX_NUMBER });
            var ix = 0;
            for (var _f = 0, _g = this.sorts; _f < _g.length; _f++) {
                var sort = _g[_f];
                var source = sort[0], field = sort[1], direction = sort[2];
                if (typeof source === "number") {
                    source = aliases[reverseLookup[source]];
                }
                else {
                    source = aliases[source];
                }
                diff.add("action mapping sorted", { action: action, ix: ix, source: source, field: field, direction: direction });
                ix++;
            }
        }
        //group
        if (this.groups) {
            var action = utils_1.uuid();
            diff.add("action", { view: view, action: action, kind: "group", ix: exports.MAX_NUMBER });
            var ix = 0;
            for (var _h = 0, _j = this.groups; _h < _j.length; _h++) {
                var group = _j[_h];
                var source = group[0], field = group[1];
                if (typeof source === "number") {
                    source = aliases[reverseLookup[source]];
                }
                else {
                    source = aliases[source];
                }
                diff.add("action mapping sorted", { action: action, ix: ix, source: source, field: field, direction: "ascending" });
                ix++;
            }
        }
        //limit
        if (this.limitInfo) {
            var action = utils_1.uuid();
            diff.add("action", { view: view, action: action, kind: "limit", ix: exports.MAX_NUMBER });
            for (var limitType in this.limitInfo) {
                diff.add("action mapping limit", { action: action, "limit type": limitType, value: this.limitInfo[limitType] });
            }
        }
        //projection
        if (this.projectionMap) {
            var action = utils_1.uuid();
            diff.add("action", { view: view, action: action, kind: "project", ix: exports.MAX_NUMBER });
            mappingToDiff(diff, action, this.projectionMap, aliases, reverseLookup);
        }
        return diff;
    };
    Query.prototype.validateFields = function (tableName, joinObject) {
        var table = this.ixer.table(tableName);
        for (var field in joinObject) {
            if (table.fields.length && !table.keyLookup[field]) {
                throw new Error("Table '" + tableName + "' doesn't have a field '" + field + "'.\n\nAvailable fields: " + table.fields.join(", "));
            }
            var joinInfo = joinObject[field];
            if (joinInfo.constructor === Array) {
                var joinNumber = joinInfo[0], referencedField = joinInfo[1];
                if (typeof joinNumber !== "number") {
                    joinNumber = this.aliases[joinNumber];
                }
                var join = this.joins[joinNumber];
                if (join && join.ix === joinNumber) {
                    var referencedTable = this.ixer.table(join.table);
                    if (!referencedTable.fields.length)
                        continue;
                    if (!referencedTable.keyLookup[referencedField]) {
                        throw new Error("Table '" + join.table + "' doesn't have a field '" + referencedField + "'.\n\nAvailable fields: " + referencedTable.fields.join(", "));
                    }
                }
            }
        }
    };
    Query.prototype.select = function (table, join, as) {
        this.dirty = true;
        if (as) {
            this.aliases[as] = Object.keys(this.aliases).length;
        }
        this.unprojectedSize++;
        this.tables.push(table);
        this.validateFields(table, join);
        this.joins.push({ negated: false, table: table, join: join, as: as, ix: this.aliases[as] });
        return this;
    };
    Query.prototype.deselect = function (table, join) {
        this.dirty = true;
        this.tables.push(table);
        this.validateFields(table, join);
        this.joins.push({ negated: true, table: table, join: join, ix: this.joins.length * 1000 });
        return this;
    };
    Query.prototype.calculate = function (funcName, args, as) {
        this.dirty = true;
        if (as) {
            this.aliases[as] = Object.keys(this.aliases).length;
        }
        if (!exports.QueryFunctions[funcName].filter) {
            this.unprojectedSize++;
        }
        this.funcs.push({ name: funcName, args: args, as: as, ix: this.aliases[as] });
        return this;
    };
    Query.prototype.project = function (projectionMap) {
        this.projectionMap = projectionMap;
        this.validateFields(undefined, projectionMap);
        return this;
    };
    Query.prototype.group = function (groups) {
        this.dirty = true;
        if (groups[0] && groups[0].constructor === Array) {
            this.groups = groups;
        }
        else {
            if (!this.groups)
                this.groups = [];
            this.groups.push(groups);
        }
        return this;
    };
    Query.prototype.sort = function (sorts) {
        this.dirty = true;
        if (sorts[0] && sorts[0].constructor === Array) {
            this.sorts = sorts;
        }
        else {
            if (!this.sorts)
                this.sorts = [];
            this.sorts.push(sorts);
        }
        return this;
    };
    Query.prototype.limit = function (limitInfo) {
        this.dirty = true;
        if (!this.limitInfo) {
            this.limitInfo = {};
        }
        for (var key in limitInfo) {
            this.limitInfo[key] = limitInfo[key];
        }
        return this;
    };
    Query.prototype.aggregate = function (funcName, args, as) {
        this.dirty = true;
        if (as) {
            this.aliases[as] = Object.keys(this.aliases).length;
        }
        this.unprojectedSize++;
        this.aggregates.push({ name: funcName, args: args, as: as, ix: this.aliases[as] });
        return this;
    };
    Query.prototype.ordinal = function () {
        this.dirty = true;
        this.hasOrdinal = true;
        this.unprojectedSize++;
        return this;
    };
    Query.prototype.applyAliases = function (joinMap) {
        for (var field in joinMap) {
            var joinInfo = joinMap[field];
            if (joinInfo.constructor !== Array || typeof joinInfo[0] === "number")
                continue;
            var joinTable = joinInfo[0];
            if (joinTable === "ordinal") {
                joinInfo[0] = this.unprojectedSize - 1;
            }
            else if (this.aliases[joinTable] !== undefined) {
                joinInfo[0] = this.aliases[joinTable];
            }
            else {
                throw new Error("Invalid alias used: " + joinTable);
            }
        }
    };
    Query.prototype.toAST = function () {
        var cursor = { type: "query",
            children: [] };
        var root = cursor;
        var results = [];
        // by default the only thing we return are the unprojected results
        var returns = ["unprojected", "provenance"];
        // we need an array to store our unprojected results
        root.children.push({ type: "declaration", var: "unprojected", value: "[]" });
        root.children.push({ type: "declaration", var: "provenance", value: "[]" });
        root.children.push({ type: "declaration", var: "projected", value: "{}" });
        // run through each table nested in the order they were given doing pairwise
        // joins along the way.
        for (var _i = 0, _a = this.joins; _i < _a.length; _i++) {
            var join = _a[_i];
            var table = join.table, ix = join.ix, negated = join.negated;
            var cur = {
                type: "select",
                table: table,
                passed: ix === 0,
                ix: ix,
                negated: negated,
                children: [],
                join: false,
            };
            // we only want to eat the cost of dealing with indexes
            // if we are actually joining on something
            var joinMap = join.join;
            this.applyAliases(joinMap);
            if (joinMap && Object.keys(joinMap).length !== 0) {
                root.children.unshift({ type: "declaration", var: "query" + ix, value: "{}" });
                cur.join = joinMap;
            }
            cursor.children.push(cur);
            if (!negated) {
                results.push({ type: "select", ix: ix });
            }
            cursor = cur;
        }
        // at the bottom of the joins, we calculate all the functions based on the values
        // collected
        for (var _b = 0, _c = this.funcs; _b < _c.length; _b++) {
            var func = _c[_b];
            var args = func.args, name_1 = func.name, ix = func.ix;
            var funcInfo = exports.QueryFunctions[name_1];
            this.applyAliases(args);
            root.children.unshift({ type: "functionDeclaration", ix: ix, info: funcInfo });
            if (funcInfo.multi || funcInfo.filter) {
                var node = { type: "functionCallMultiReturn", ix: ix, args: args, info: funcInfo, children: [] };
                cursor.children.push(node);
                cursor = node;
            }
            else {
                cursor.children.push({ type: "functionCall", ix: ix, args: args, info: funcInfo, children: [] });
            }
            if (!funcInfo.noReturn && !funcInfo.filter) {
                results.push({ type: "function", ix: ix });
            }
        }
        // now that we're at the bottom of the join, store the unprojected result
        cursor.children.push({ type: "result", results: results });
        //Aggregation
        //sort the unprojected results based on groupings and the given sorts
        var sorts = [];
        var alreadySorted = {};
        if (this.groups) {
            this.applyAliases(this.groups);
            for (var _d = 0, _e = this.groups; _d < _e.length; _d++) {
                var group = _e[_d];
                var table = group[0], field = group[1];
                sorts.push(group);
                alreadySorted[(table + "|" + field)] = true;
            }
        }
        if (this.sorts) {
            this.applyAliases(this.sorts);
            for (var _f = 0, _g = this.sorts; _f < _g.length; _f++) {
                var sort = _g[_f];
                var table = sort[0], field = sort[1];
                if (!alreadySorted[(table + "|" + field)]) {
                    sorts.push(sort);
                }
            }
        }
        var size = this.unprojectedSize;
        if (sorts.length) {
            root.children.push({ type: "sort", sorts: sorts, size: size, children: [] });
        }
        //then we need to run through the sorted items and do the aggregate as a fold.
        if (this.aggregates.length || sorts.length || this.limitInfo || this.hasOrdinal) {
            // we need to store group info for post processing of the unprojected results
            // this will indicate what group number, if any, that each unprojected result belongs to
            root.children.unshift({ type: "declaration", var: "groupInfo", value: "[]" });
            returns.push("groupInfo");
            var aggregateChildren = [];
            for (var _h = 0, _j = this.aggregates; _h < _j.length; _h++) {
                var func = _j[_h];
                var args = func.args, name_2 = func.name, ix = func.ix;
                var funcInfo = exports.QueryFunctions[name_2];
                this.applyAliases(args);
                root.children.unshift({ type: "functionDeclaration", ix: ix, info: funcInfo });
                aggregateChildren.push({ type: "functionCall", ix: ix, resultsIx: results.length, args: args, info: funcInfo, unprojected: true, children: [] });
                results.push({ type: "placeholder" });
            }
            if (this.hasOrdinal === true) {
                aggregateChildren.push({ type: "ordinal" });
                results.push({ type: "placeholder" });
            }
            var aggregate = { type: "aggregate loop", groups: this.groups, limit: this.limitInfo, size: size, children: aggregateChildren };
            root.children.push(aggregate);
            cursor = aggregate;
        }
        if (this.projectionMap) {
            this.applyAliases(this.projectionMap);
            root.children.unshift({ type: "declaration", var: "results", value: "[]" });
            if (exports.INCREMENTAL) {
                cursor.children.push({ type: "provenance" });
            }
            cursor.children.push({ type: "projection", projectionMap: this.projectionMap, unprojected: this.aggregates.length });
            returns.push("results");
        }
        root.children.push({ type: "return", vars: returns });
        return root;
    };
    Query.prototype.compileParamString = function (funcInfo, args, unprojected) {
        if (unprojected === void 0) { unprojected = false; }
        var code = "";
        var params = funcInfo.params;
        if (unprojected)
            params = params.slice(1);
        for (var _i = 0; _i < params.length; _i++) {
            var param = params[_i];
            var arg = args[param];
            var argCode = void 0;
            if (arg.constructor === Array) {
                var property = "";
                if (arg[1]) {
                    property = "['" + arg[1] + "']";
                }
                if (!unprojected) {
                    argCode = "row" + arg[0] + property;
                }
                else {
                    argCode = "unprojected[ix + " + arg[0] + "]" + property;
                }
            }
            else {
                argCode = JSON.stringify(arg);
            }
            code += argCode + ", ";
        }
        return code.substring(0, code.length - 2);
    };
    Query.prototype.compileAST = function (root) {
        var code = "";
        var type = root.type;
        switch (type) {
            case "query":
                for (var _i = 0, _a = root.children; _i < _a.length; _i++) {
                    var child = _a[_i];
                    code += this.compileAST(child);
                }
                break;
            case "declaration":
                code += "var " + root.var + " = " + root.value + ";\n";
                break;
            case "functionDeclaration":
                code += "var func" + root.ix + " = QueryFunctions['" + root.info.name + "'].func;\n";
                break;
            case "functionCall":
                var ix = root.ix;
                var prev = "";
                if (root.unprojected) {
                    prev = "row" + ix;
                    if (root.info.params.length > 1)
                        prev += ",";
                }
                code += "var row" + ix + " = func" + ix + "(" + prev + this.compileParamString(root.info, root.args, root.unprojected) + ");\n";
                break;
            case "functionCallMultiReturn":
                var ix = root.ix;
                code += "var rows" + ix + " = func" + ix + "(" + this.compileParamString(root.info, root.args) + ");\n";
                code += "for(var funcResultIx" + ix + " = 0, funcLen" + ix + " = rows" + ix + ".length; funcResultIx" + ix + " < funcLen" + ix + "; funcResultIx" + ix + "++) {\n";
                code += "var row" + ix + " = rows" + ix + "[funcResultIx" + ix + "];\n";
                for (var _b = 0, _c = root.children; _b < _c.length; _b++) {
                    var child = _c[_b];
                    code += this.compileAST(child);
                }
                code += "}\n";
                break;
            case "select":
                var ix = root.ix;
                if (root.passed) {
                    code += "var rows" + ix + " = rootRows;\n";
                }
                else if (root.join) {
                    for (var key in root.join) {
                        var mapping = root.join[key];
                        if (mapping.constructor === Array) {
                            var tableIx = mapping[0], value = mapping[1];
                            code += "query" + ix + "['" + key + "'] = row" + tableIx + "['" + value + "'];\n";
                        }
                        else {
                            code += "query" + ix + "['" + key + "'] = " + JSON.stringify(mapping) + ";\n";
                        }
                    }
                    code += "var rows" + ix + " = ixer.factToIndex(ixer.table('" + root.table + "'), query" + ix + ");\n";
                }
                else {
                    code += "var rows" + ix + " = ixer.table('" + root.table + "').table;\n";
                }
                if (!root.negated) {
                    code += "for(var rowIx" + ix + " = 0, rowsLen" + ix + " = rows" + ix + ".length; rowIx" + ix + " < rowsLen" + ix + "; rowIx" + ix + "++) {\n";
                    code += "var row" + ix + " = rows" + ix + "[rowIx" + ix + "];\n";
                }
                else {
                    code += "if(!rows" + ix + ".length) {\n";
                }
                for (var _d = 0, _e = root.children; _d < _e.length; _d++) {
                    var child = _e[_d];
                    code += this.compileAST(child);
                }
                code += "}\n";
                break;
            case "result":
                var results = [];
                for (var _f = 0, _g = root.results; _f < _g.length; _f++) {
                    var result = _g[_f];
                    if (result.type === "placeholder") {
                        results.push("undefined");
                    }
                    else {
                        var ix_1 = result.ix;
                        results.push("row" + ix_1);
                    }
                }
                code += "unprojected.push(" + results.join(", ") + ");\n";
                break;
            case "sort":
                code += generateUnprojectedSorterCode(root.size, root.sorts) + "\n";
                break;
            case "aggregate loop":
                var projection = "";
                var aggregateCalls = [];
                var aggregateStates = [];
                var aggregateResets = [];
                var unprojected = {};
                var ordinal = false;
                var provenanceCode;
                for (var _h = 0, _j = root.children; _h < _j.length; _h++) {
                    var agg = _j[_h];
                    if (agg.type === "functionCall") {
                        unprojected[agg.ix] = true;
                        var compiled = this.compileAST(agg);
                        compiled += "\nunprojected[ix + " + agg.resultsIx + "] = row" + agg.ix + ";\n";
                        aggregateCalls.push(compiled);
                        aggregateStates.push("var row" + agg.ix + " = {};");
                        aggregateResets.push("row" + agg.ix + " = {};");
                    }
                    else if (agg.type === "projection") {
                        agg.unprojected = unprojected;
                        projection = this.compileAST(agg);
                    }
                    else if (agg.type === "ordinal") {
                        ordinal = "unprojected[ix+" + (this.unprojectedSize - 1) + "] = resultCount;\n";
                    }
                    else if (agg.type === "provenance") {
                        provenanceCode = this.compileAST(agg);
                    }
                }
                var aggregateCallsCode = aggregateCalls.join("");
                var differentGroupChecks = [];
                var groupCheck = "false";
                if (root.groups) {
                    for (var _k = 0, _l = root.groups; _k < _l.length; _k++) {
                        var group = _l[_k];
                        var table = group[0], field = group[1];
                        differentGroupChecks.push("unprojected[nextIx + " + table + "]['" + field + "'] !== unprojected[ix + " + table + "]['" + field + "']");
                    }
                    groupCheck = "(" + differentGroupChecks.join(" || ") + ")";
                }
                var resultsCheck = "";
                if (root.limit && root.limit.results) {
                    var limitValue = root.limit.results;
                    var offset = root.limit.offset;
                    if (offset) {
                        limitValue += offset;
                        projection = "if(resultCount >= " + offset + ") {\n              " + projection + "\n            }";
                    }
                    resultsCheck = "if(resultCount === " + limitValue + ") break;";
                }
                var groupLimitCheck = "";
                if (root.limit && root.limit.perGroup && root.groups) {
                    var limitValue = root.limit.perGroup;
                    var offset = root.limit.offset;
                    if (offset) {
                        limitValue += offset;
                        aggregateCallsCode = "if(perGroupCount >= " + offset + ") {\n              " + aggregateCallsCode + "\n            }";
                    }
                    groupLimitCheck = "if(perGroupCount === " + limitValue + ") {\n            while(!differentGroup) {\n              nextIx += " + root.size + ";\n              if(nextIx >= len) break;\n              groupInfo[nextIx] = undefined;\n              differentGroup = " + groupCheck + ";\n            }\n          }";
                }
                var groupDifference = "";
                var groupInfo = "";
                if (this.groups) {
                    groupInfo = "groupInfo[ix] = resultCount;";
                    var groupProjection = projection + "resultCount++;";
                    if (root.limit && root.limit.offset) {
                        groupProjection = "if(perGroupCount > " + root.limit.offset + ") {\n              " + groupProjection + "\n            }";
                        groupInfo = "if(perGroupCount >= " + root.limit.offset + ") {\n              " + groupInfo + "\n            }";
                    }
                    groupDifference = "\n          perGroupCount++\n          var differentGroup = " + groupCheck + ";\n          " + groupLimitCheck + "\n          if(differentGroup) {\n            " + groupProjection + "\n            " + aggregateResets.join("\n") + "\n            perGroupCount = 0;\n          }\n";
                }
                else {
                    groupDifference = "resultCount++;\n";
                    groupInfo = "groupInfo[ix] = 0;";
                }
                // if there are neither aggregates to calculate nor groups to build,
                // then we just need to worry about limiting
                if (!this.groups && aggregateCalls.length === 0) {
                    code = "var ix = 0;\n                  var resultCount = 0;\n                  var len = unprojected.length;\n                  while(ix < len) {\n                    " + resultsCheck + "\n                    " + (ordinal || "") + "\n                    " + provenanceCode + "\n                    " + projection + "\n                    groupInfo[ix] = resultCount;\n                    resultCount++;\n                    ix += " + root.size + ";\n                  }\n";
                    break;
                }
                code = "var resultCount = 0;\n                var perGroupCount = 0;\n                var ix = 0;\n                var nextIx = 0;\n                var len = unprojected.length;\n                " + aggregateStates.join("\n") + "\n                while(ix < len) {\n                  " + aggregateCallsCode + "\n                  " + groupInfo + "\n                  " + (ordinal || "") + "\n                  " + provenanceCode + "\n                  if(ix + " + root.size + " === len) {\n                    " + projection + "\n                    break;\n                  }\n                  nextIx += " + root.size + ";\n                  " + groupDifference + "\n                  " + resultsCheck + "\n                  ix = nextIx;\n                }\n";
                break;
            case "projection":
                var projectedVars = [];
                var idStringParts = [];
                for (var newField in root.projectionMap) {
                    var mapping = root.projectionMap[newField];
                    var value = "";
                    if (mapping.constructor === Array) {
                        if (mapping[1] === undefined) {
                            value = "unprojected[ix + " + mapping[0] + "]";
                        }
                        else if (!root.unprojected || root.unprojected[mapping[0]]) {
                            value = "row" + mapping[0] + "['" + mapping[1] + "']";
                        }
                        else {
                            value = "unprojected[ix + " + mapping[0] + "]['" + mapping[1] + "']";
                        }
                    }
                    else {
                        value = JSON.stringify(mapping);
                    }
                    projectedVars.push("projected['" + newField.replace(/'/g, "\\'") + "'] = " + value);
                    idStringParts.push(value);
                }
                code += projectedVars.join(";\n") + "\n";
                code += "projected.__id = " + idStringParts.join(" + \"|\" + ") + ";\n";
                code += "results.push(projected);\n";
                code += "projected = {};\n";
                break;
            case "provenance":
                var provenance = "var provenance__id = '';\n";
                var ids = [];
                for (var _m = 0, _o = this.joins; _m < _o.length; _m++) {
                    var join = _o[_m];
                    if (join.negated)
                        continue;
                    provenance += "provenance__id = tableId + '|' + projected.__id + '|' + rowInstance + '|" + join.table + "|' + row" + join.ix + ".__id; \n";
                    provenance += "provenance.push({table: tableId, row: projected, \"row instance\": rowInstance, source: \"" + join.table + "\", \"source row\": row" + join.ix + "});\n";
                    ids.push("row" + join.ix + ".__id");
                }
                code = "var rowInstance = " + ids.join(" + '|' + ") + ";\n        " + provenance;
                break;
            case "return":
                var returns = [];
                for (var _p = 0, _q = root.vars; _p < _q.length; _p++) {
                    var curVar = _q[_p];
                    returns.push(curVar + ": " + curVar);
                }
                code += "return {" + returns.join(", ") + "};";
                break;
        }
        return code;
    };
    // given a set of changes and a join order, determine the root facts that need
    // to be joined again to cover all the adds
    Query.prototype.reverseJoin = function (joins) {
        var changed = joins[0];
        var reverseJoinMap = {};
        // collect all the constraints and reverse them
        for (var _i = 0; _i < joins.length; _i++) {
            var join = joins[_i];
            for (var key in join.join) {
                var _a = join.join[key], source = _a[0], field = _a[1];
                if (source <= changed.ix) {
                    if (!reverseJoinMap[source]) {
                        reverseJoinMap[source] = {};
                    }
                    if (!reverseJoinMap[source][field])
                        reverseJoinMap[source][field] = [join.ix, key];
                }
            }
        }
        var recurse = function (joins, joinIx) {
            var code = "";
            if (joinIx >= joins.length) {
                return "others.push(row0)";
            }
            var _a = joins[joinIx], table = _a.table, ix = _a.ix, negated = _a.negated;
            var joinMap = joins[joinIx].join;
            // we only care about this guy if he's joined with at least one thing
            if (!reverseJoinMap[ix] && joinIx < joins.length - 1)
                return recurse(joins, joinIx + 1);
            else if (!reverseJoinMap)
                return "";
            var mappings = [];
            for (var key in reverseJoinMap[ix]) {
                var _b = reverseJoinMap[ix][key], sourceIx = _b[0], field = _b[1];
                if (sourceIx === changed.ix || reverseJoinMap[sourceIx] !== undefined) {
                    mappings.push("'" + key + "': row" + sourceIx + "['" + field + "']");
                }
            }
            for (var key in joinMap) {
                var value = joinMap[key];
                if (value.constructor !== Array) {
                    mappings.push("'" + key + "': " + JSON.stringify(value));
                }
            }
            if (negated) {
            }
            code += "\n            var rows" + ix + " = eve.find('" + table + "', {" + mappings.join(", ") + "});\n            for(var rowsIx" + ix + " = 0, rowsLen" + ix + " = rows" + ix + ".length; rowsIx" + ix + " < rowsLen" + ix + "; rowsIx" + ix + "++) {\n                var row" + ix + " = rows" + ix + "[rowsIx" + ix + "];\n                " + recurse(joins, joinIx + 1) + "\n            }\n            ";
            return code;
        };
        return recurse(joins, 1);
    };
    Query.prototype.compileIncrementalRowFinderCode = function () {
        var code = "var others = [];\n";
        var reversed = this.joins.slice().reverse();
        var checks = [];
        var ix = 0;
        for (var _i = 0; _i < reversed.length; _i++) {
            var join = reversed[_i];
            // we don't want to do this for the root
            if (ix === reversed.length - 1)
                break;
            checks.push("\n\t\t\tif(changes[\"" + join.table + "\"] && changes[\"" + join.table + "\"].adds) {\n                var curChanges" + join.ix + " = changes[\"" + join.table + "\"].adds;\n                for(var changeIx" + join.ix + " = 0, changeLen" + join.ix + " = curChanges" + join.ix + ".length; changeIx" + join.ix + " < changeLen" + join.ix + "; changeIx" + join.ix + "++) {\n                    var row" + join.ix + " = curChanges" + join.ix + "[changeIx" + join.ix + "];\n\t\t\t\t\t" + this.reverseJoin(reversed.slice(ix)) + "\n\t\t\t\t}\n\t\t\t}");
            ix++;
        }
        code += checks.join(" else");
        var last = reversed[ix];
        code += "\n\t\t\tif(changes[\"" + last.table + "\"] && changes[\"" + last.table + "\"].adds) {\n                var curChanges = changes[\"" + last.table + "\"].adds;\n\t\t\t\tfor(var changeIx = 0, changeLen = curChanges.length; changeIx < changeLen; changeIx++) {\n\t\t\t\t\tothers.push(curChanges[changeIx]);\n\t\t\t\t}\n\t\t\t}\n\t\t\treturn others;";
        return code;
    };
    Query.prototype.incrementalRemove = function (changes) {
        var ixer = this.ixer;
        var rowsToPostCheck = [];
        var provenanceDiff = this.ixer.diff();
        var removes = [];
        var indexes = ixer.table("provenance").indexes;
        var sourceRowLookup = indexes["source|source row|table"].index;
        var rowInstanceLookup = indexes["row instance|table"].index;
        var tableRowLookup = indexes["row|table"].index;
        var provenanceRemoves = [];
        var visited = {};
        for (var _i = 0, _a = this.joins; _i < _a.length; _i++) {
            var join = _a[_i];
            var change = changes[join.table];
            if (!visited[join.table] && change && change.removes.length) {
                visited[join.table] = true;
                for (var _b = 0, _c = change.removes; _b < _c.length; _b++) {
                    var remove = _c[_b];
                    var provenances = sourceRowLookup[join.table + '|' + remove.__id + '|' + this.name];
                    if (provenances) {
                        for (var _d = 0; _d < provenances.length; _d++) {
                            var provenance = provenances[_d];
                            if (!visited[provenance["row instance"]]) {
                                visited[provenance["row instance"]] = true;
                                var relatedProvenance = rowInstanceLookup[provenance["row instance"] + '|' + provenance.table];
                                for (var _e = 0; _e < relatedProvenance.length; _e++) {
                                    var related = relatedProvenance[_e];
                                    provenanceRemoves.push(related);
                                }
                            }
                            rowsToPostCheck.push(provenance);
                        }
                    }
                }
            }
        }
        provenanceDiff.removeFacts("provenance", provenanceRemoves);
        ixer.applyDiffIncremental(provenanceDiff);
        var isEdb = ixer.edbTables;
        for (var _f = 0; _f < rowsToPostCheck.length; _f++) {
            var row = rowsToPostCheck[_f];
            var supports = tableRowLookup[row.row.__id + '|' + row.table];
            if (!supports || supports.length === 0) {
                removes.push(row.row);
            }
        }
        return removes;
    };
    Query.prototype.canBeIncremental = function () {
        if (this.aggregates.length)
            return false;
        if (this.sorts)
            return false;
        if (this.groups)
            return false;
        if (this.limitInfo)
            return false;
        for (var _i = 0, _a = this.joins; _i < _a.length; _i++) {
            var join = _a[_i];
            if (join.negated)
                return false;
        }
        if (!this.joins.length)
            return false;
        return true;
    };
    Query.prototype.compile = function () {
        var ast = this.toAST();
        var code = this.compileAST(ast);
        this.compiled = new Function("ixer", "QueryFunctions", "tableId", "rootRows", code);
        if (this.canBeIncremental()) {
            this.incrementalRowFinder = new Function("changes", this.compileIncrementalRowFinderCode());
        }
        else {
            this.incrementalRowFinder = undefined;
        }
        this.dirty = false;
        return this;
    };
    Query.prototype.exec = function () {
        if (this.dirty) {
            this.compile();
        }
        var root = this.joins[0];
        var rows;
        if (root) {
            rows = this.ixer.find(root.table, root.join);
        }
        else {
            rows = [];
        }
        return this.compiled(this.ixer, exports.QueryFunctions, this.name, rows);
    };
    Query.prototype.execIncremental = function (changes, table) {
        if (this.dirty) {
            this.compile();
        }
        if (this.incrementalRowFinder) {
            var potentialRows = this.incrementalRowFinder(changes);
            // if the root select has some constant filters, then
            // the above rows need to be filtered down to only those that
            // match.
            var rows = [];
            var root = this.joins[0];
            var rootKeys = Object.keys(root.join);
            if (rootKeys.length > 0) {
                rowLoop: for (var _i = 0; _i < potentialRows.length; _i++) {
                    var row = potentialRows[_i];
                    for (var _a = 0; _a < rootKeys.length; _a++) {
                        var key = rootKeys[_a];
                        if (row[key] !== root.join[key])
                            continue rowLoop;
                    }
                    rows.push(row);
                }
            }
            else {
                rows = potentialRows;
            }
            var results = this.compiled(this.ixer, exports.QueryFunctions, this.name, rows);
            var adds = [];
            var prevHashes = table.factHash;
            var prevKeys = Object.keys(prevHashes);
            var suggestedRemoves = this.incrementalRemove(changes);
            var realDiff = diffAddsAndRemoves(results.results, suggestedRemoves);
            for (var _b = 0, _c = realDiff.adds; _b < _c.length; _b++) {
                var result = _c[_b];
                var id = result.__id;
                if (prevHashes[id] === undefined) {
                    adds.push(result);
                }
            }
            var diff = this.ixer.diff();
            diff.addMany("provenance", results.provenance);
            this.ixer.applyDiffIncremental(diff);
            // console.log("INC PROV DIFF", this.name, diff.length);
            return { provenance: results.provenance, adds: adds, removes: realDiff.removes };
        }
        else {
            var results = this.exec();
            var adds = [];
            var removes = [];
            var prevHashes = table.factHash;
            var prevKeys = Object.keys(prevHashes);
            var newHashes = {};
            for (var _d = 0, _e = results.results; _d < _e.length; _d++) {
                var result = _e[_d];
                var id = result.__id;
                newHashes[id] = result;
                if (prevHashes[id] === undefined) {
                    adds.push(result);
                }
            }
            for (var _f = 0; _f < prevKeys.length; _f++) {
                var hash = prevKeys[_f];
                var value = newHashes[hash];
                if (value === undefined) {
                    removes.push(prevHashes[hash]);
                }
            }
            var realDiff = diffAddsAndRemoves(adds, removes);
            var diff = this.ixer.diff();
            diff.remove("provenance", { table: this.name });
            diff.addMany("provenance", results.provenance);
            this.ixer.applyDiffIncremental(diff);
            // console.log("FULL PROV SIZE", this.name, diff.length);
            return { provenance: results.provenance, adds: realDiff.adds, removes: realDiff.removes };
        }
    };
    Query.prototype.debug = function () {
        console.log(this.compileAST(this.toAST()));
        console.time("exec");
        var results = this.exec();
        console.timeEnd("exec");
        console.log(results);
        return results;
    };
    return Query;
})();
exports.Query = Query;
var Union = (function () {
    function Union(ixer, name) {
        if (name === void 0) { name = "unknown"; }
        this.name = name;
        this.ixer = ixer;
        this.tables = [];
        this.sources = [];
        this.isStateful = false;
        this.prev = { results: [], hashes: {} };
        this.dirty = true;
    }
    Union.prototype.changeset = function (ixer) {
        var diff = ixer.diff();
        diff.add("view", { view: this.name, kind: "union" });
        for (var _i = 0, _a = this.sources; _i < _a.length; _i++) {
            var source = _a[_i];
            if (source.type === "+") {
                var action = utils_1.uuid();
                diff.add("action", { view: this.name, action: action, kind: "union", ix: 0 });
                diff.add("action source", { action: action, "source view": source.table });
                for (var field in source.mapping) {
                    var mapped = source.mapping[field];
                    if (mapped.constructor === Array)
                        diff.add("action mapping", { action: action, from: field, "to source": source.table, "to field": mapped[0] });
                    else
                        diff.add("action mapping constant", { action: action, from: field, value: mapped });
                }
            }
            else
                throw new Error("Unknown source type: '" + source.type + "'");
        }
        return diff;
    };
    Union.prototype.ensureHasher = function (mapping) {
        if (!this.hasher) {
            this.hasher = generateStringFn(Object.keys(mapping));
        }
    };
    Union.prototype.union = function (tableName, mapping) {
        this.dirty = true;
        this.ensureHasher(mapping);
        this.tables.push(tableName);
        this.sources.push({ type: "+", table: tableName, mapping: mapping });
        return this;
    };
    Union.prototype.toAST = function () {
        var root = { type: "union", children: [] };
        root.children.push({ type: "declaration", var: "results", value: "[]" });
        root.children.push({ type: "declaration", var: "provenance", value: "[]" });
        var hashesValue = "{}";
        if (this.isStateful) {
            hashesValue = "prevHashes";
        }
        root.children.push({ type: "declaration", var: "hashes", value: hashesValue });
        var ix = 0;
        for (var _i = 0, _a = this.sources; _i < _a.length; _i++) {
            var source = _a[_i];
            var action = void 0;
            if (source.type === "+") {
                action = { type: "result", ix: ix, children: [{ type: "provenance", source: source, ix: ix }] };
            }
            root.children.push({
                type: "source",
                ix: ix,
                table: source.table,
                mapping: source.mapping,
                children: [action],
            });
            ix++;
        }
        root.children.push({ type: "hashesToResults" });
        root.children.push({ type: "return", vars: ["results", "hashes", "provenance"] });
        return root;
    };
    Union.prototype.compileAST = function (root) {
        var code = "";
        var type = root.type;
        switch (type) {
            case "union":
                for (var _i = 0, _a = root.children; _i < _a.length; _i++) {
                    var child = _a[_i];
                    code += this.compileAST(child);
                }
                break;
            case "declaration":
                code += "var " + root.var + " = " + root.value + ";\n";
                break;
            case "source":
                var ix = root.ix;
                var mappingItems = [];
                for (var key in root.mapping) {
                    var mapping = root.mapping[key];
                    var value = void 0;
                    if (mapping.constructor === Array && mapping.length === 1) {
                        var field = mapping[0];
                        value = "sourceRow" + ix + "['" + field + "']";
                    }
                    else if (mapping.constructor === Array && mapping.length === 2) {
                        var _ = mapping[0], field = mapping[1];
                        value = "sourceRow" + ix + "['" + field + "']";
                    }
                    else {
                        value = JSON.stringify(mapping);
                    }
                    mappingItems.push("'" + key + "': " + value);
                }
                code += "var sourceRows" + ix + " = changes['" + root.table.replace(/'/g, "\\'") + "'];\n";
                code += "for(var rowIx" + ix + " = 0, rowsLen" + ix + " = sourceRows" + ix + ".length; rowIx" + ix + " < rowsLen" + ix + "; rowIx" + ix + "++) {\n";
                code += "var sourceRow" + ix + " = sourceRows" + ix + "[rowIx" + ix + "];\n";
                code += "var mappedRow" + ix + " = {" + mappingItems.join(", ") + "};\n";
                for (var _b = 0, _c = root.children; _b < _c.length; _b++) {
                    var child = _c[_b];
                    code += this.compileAST(child);
                }
                code += "}\n";
                break;
            case "result":
                var ix = root.ix;
                code += "var hash" + ix + " = hasher(mappedRow" + ix + ");\n";
                code += "mappedRow" + ix + ".__id = hash" + ix + ";\n";
                code += "hashes[hash" + ix + "] = mappedRow" + ix + ";\n";
                for (var _d = 0, _e = root.children; _d < _e.length; _d++) {
                    var child = _e[_d];
                    code += this.compileAST(child);
                }
                break;
            case "removeResult":
                var ix = root.ix;
                code += "hashes[hasher(mappedRow" + ix + ")] = false;\n";
                break;
            case "hashesToResults":
                code += "var hashKeys = Object.keys(hashes);\n";
                code += "for(var hashKeyIx = 0, hashKeyLen = hashKeys.length; hashKeyIx < hashKeyLen; hashKeyIx++) {\n";
                code += "var curHashKey = hashKeys[hashKeyIx];";
                code += "var value = hashes[curHashKey];\n";
                code += "if(value !== false) {\n";
                code += "value.__id = curHashKey;\n";
                code += "results.push(value);\n";
                code += "}\n";
                code += "}\n";
                break;
            case "provenance":
                var source = root.source.table;
                var ix = root.ix;
                var provenance = "var provenance__id = '';\n";
                provenance += "provenance__id = '" + this.name.replace(/'/g, "\\'") + "|' + mappedRow" + ix + ".__id + '|' + rowInstance + '|" + source.replace(/'/g, "\\'") + "|' + sourceRow" + ix + ".__id; \n";
                provenance += "provenance.push({table: '" + this.name.replace(/'/g, "\\'") + "', row: mappedRow" + ix + ", \"row instance\": rowInstance, source: \"" + source.replace(/'/g, "\\'") + "\", \"source row\": sourceRow" + ix + "});\n";
                code = "var rowInstance = \"" + source.replace(/'/g, "\\'") + "|\" + mappedRow" + ix + ".__id;\n        " + provenance;
                break;
            case "return":
                code += "return {" + root.vars.map(function (name) { return (name + ": " + name); }).join(", ") + "};";
                break;
        }
        return code;
    };
    Union.prototype.compile = function () {
        var ast = this.toAST();
        var code = this.compileAST(ast);
        this.compiled = new Function("ixer", "hasher", "changes", code);
        this.dirty = false;
        return this;
    };
    Union.prototype.debug = function () {
        var code = this.compileAST(this.toAST());
        console.log(code);
        return code;
    };
    Union.prototype.exec = function () {
        if (this.dirty) {
            this.compile();
        }
        var changes = {};
        for (var _i = 0, _a = this.sources; _i < _a.length; _i++) {
            var source = _a[_i];
            changes[source.table] = this.ixer.table(source.table).table;
        }
        var results = this.compiled(this.ixer, this.hasher, changes);
        return results;
    };
    Union.prototype.incrementalRemove = function (changes) {
        var ixer = this.ixer;
        var rowsToPostCheck = [];
        var provenanceDiff = this.ixer.diff();
        var removes = [];
        var indexes = ixer.table("provenance").indexes;
        var sourceRowLookup = indexes["source|source row|table"].index;
        var rowInstanceLookup = indexes["row instance|table"].index;
        var tableRowLookup = indexes["row|table"].index;
        var provenanceRemoves = [];
        var visited = {};
        for (var _i = 0, _a = this.sources; _i < _a.length; _i++) {
            var source = _a[_i];
            var change = changes[source.table];
            if (!visited[source.table] && change && change.removes.length) {
                visited[source.table] = true;
                for (var _b = 0, _c = change.removes; _b < _c.length; _b++) {
                    var remove = _c[_b];
                    var provenances = sourceRowLookup[source.table + '|' + remove.__id + '|' + this.name];
                    if (provenances) {
                        for (var _d = 0; _d < provenances.length; _d++) {
                            var provenance = provenances[_d];
                            if (!visited[provenance["row instance"]]) {
                                visited[provenance["row instance"]] = true;
                                var relatedProvenance = rowInstanceLookup[provenance["row instance"] + '|' + provenance.table];
                                for (var _e = 0; _e < relatedProvenance.length; _e++) {
                                    var related = relatedProvenance[_e];
                                    provenanceRemoves.push(related);
                                }
                            }
                            rowsToPostCheck.push(provenance);
                        }
                    }
                }
            }
        }
        provenanceDiff.removeFacts("provenance", provenanceRemoves);
        ixer.applyDiffIncremental(provenanceDiff);
        var isEdb = ixer.edbTables;
        for (var _f = 0; _f < rowsToPostCheck.length; _f++) {
            var row = rowsToPostCheck[_f];
            var supports = tableRowLookup[row.row.__id + '|' + row.table];
            if (!supports || supports.length === 0) {
                removes.push(row.row);
            }
            else if (this.sources.length > 2) {
                var supportsToRemove = [];
                // otherwise if there are supports, then we need to walk the support
                // graph backwards and make sure every supporting row terminates at an
                // edb value. If not, then that support also needs to be removed
                for (var _g = 0; _g < supports.length; _g++) {
                    var support = supports[_g];
                    // if the support is already an edb, we're good to go.
                    if (isEdb[support.source])
                        continue;
                    if (!tableRowLookup[support["source row"].__id + '|' + support.source]) {
                        supportsToRemove.push(support);
                        continue;
                    }
                    // get all the supports for this support
                    var nodes = tableRowLookup[support["source row"].__id + '|' + support.source].slice();
                    var nodeIx = 0;
                    // iterate through all the nodes, if they have further supports then
                    // assume this node is ok and add those supports to the list of nodes to
                    // check. If we run into a node with no supports it must either be an edb
                    // or it's unsupported and this row instance needs to be removed.
                    while (nodeIx < nodes.length) {
                        var node = nodes[nodeIx];
                        if (isEdb[node.source]) {
                            nodeIx++;
                            continue;
                        }
                        var nodeSupports = tableRowLookup[node["source row"].__id + '|' + node.source];
                        if (!nodeSupports || nodeSupports.length === 0) {
                            supportsToRemove.push(support);
                            break;
                        }
                        else {
                            for (var _h = 0; _h < nodeSupports.length; _h++) {
                                var nodeSupport = nodeSupports[_h];
                                nodes.push(nodeSupport);
                            }
                            nodeIx++;
                        }
                    }
                }
                if (supportsToRemove.length) {
                    // we need to remove all the supports
                    var provenanceRemoves_1 = [];
                    for (var _j = 0; _j < supportsToRemove.length; _j++) {
                        var support = supportsToRemove[_j];
                        var relatedProvenance = rowInstanceLookup[support["row instance"] + '|' + support.table];
                        for (var _k = 0; _k < relatedProvenance.length; _k++) {
                            var related = relatedProvenance[_k];
                            provenanceRemoves_1.push(related);
                        }
                    }
                    var diff = ixer.diff();
                    diff.removeFacts("provenance", provenanceRemoves_1);
                    ixer.applyDiffIncremental(diff);
                    // now that all the unsupported provenances have been removed, check if there's anything
                    // left.
                    if (!tableRowLookup[row.row.__id + '|' + row.table] || tableRowLookup[row.row.__id + '|' + row.table].length === 0) {
                        removes.push(row.row);
                    }
                }
            }
        }
        return removes;
    };
    Union.prototype.execIncremental = function (changes, table) {
        if (this.dirty) {
            this.compile();
        }
        var sourceChanges = {};
        for (var _i = 0, _a = this.sources; _i < _a.length; _i++) {
            var source = _a[_i];
            var value = void 0;
            if (!changes[source.table]) {
                value = [];
            }
            else {
                value = changes[source.table].adds;
            }
            sourceChanges[source.table] = value;
        }
        var results = this.compiled(this.ixer, this.hasher, sourceChanges);
        var adds = [];
        var prevHashes = table.factHash;
        var prevKeys = Object.keys(prevHashes);
        var suggestedRemoves = this.incrementalRemove(changes);
        var realDiff = diffAddsAndRemoves(results.results, suggestedRemoves);
        for (var _b = 0, _c = realDiff.adds; _b < _c.length; _b++) {
            var result = _c[_b];
            var id = result.__id;
            if (prevHashes[id] === undefined) {
                adds.push(result);
            }
        }
        var diff = this.ixer.diff();
        diff.addMany("provenance", results.provenance);
        this.ixer.applyDiffIncremental(diff);
        return { provenance: results.provenance, adds: adds, removes: realDiff.removes };
    };
    return Union;
})();
exports.Union = Union;
//---------------------------------------------------------
// Builtin Primitives
//---------------------------------------------------------
runtime.define("count", { aggregate: true, result: "count" }, function (prev) {
    if (!prev.count) {
        prev.count = 0;
    }
    prev.count++;
    return prev;
});
runtime.define("sum", { aggregate: true, result: "sum" }, function (prev, value) {
    if (!prev.sum) {
        prev.sum = 0;
    }
    prev.sum += value;
    return prev;
});
runtime.define("average", { aggregate: true, result: "average" }, function (prev, value) {
    if (!prev.sum) {
        prev.sum = 0;
        prev.count = 0;
    }
    prev.count++;
    prev.sum += value;
    prev.average = prev.sum / prev.count;
    return prev;
});
runtime.define("lowercase", { result: "lowercase" }, function (text) {
    if (typeof text === "string") {
        return { result: text.toLowerCase() };
    }
    return { result: text };
});
runtime.define("=", { filter: true, inverse: "!=" }, function (a, b) {
    return a === b ? runtime.SUCCEED : runtime.FAIL;
});
runtime.define("!=", { filter: true, inverse: "=" }, function (a, b) {
    return a !== b ? runtime.SUCCEED : runtime.FAIL;
});
runtime.define(">", { filter: true, inverse: "<=" }, function (a, b) {
    return a > b ? runtime.SUCCEED : runtime.FAIL;
});
runtime.define("<", { filter: true, inverse: ">=" }, function (a, b) {
    return a < b ? runtime.SUCCEED : runtime.FAIL;
});
runtime.define(">=", { filter: true, inverse: "<" }, function (a, b) {
    return a >= b ? runtime.SUCCEED : runtime.FAIL;
});
runtime.define("<=", { filter: true, inverse: ">" }, function (a, b) {
    return a <= b ? runtime.SUCCEED : runtime.FAIL;
});
runtime.define("+", { result: "result" }, function (a, b) {
    return { result: a + b };
});
runtime.define("-", { result: "result" }, function (a, b) {
    return { result: a - b };
});
runtime.define("*", { result: "result" }, function (a, b) {
    return { result: a * b };
});
runtime.define("/", { result: "result" }, function (a, b) {
    return { result: a / b };
});
runtime.define("^", { result: "result" }, function (a, b) {
    return { result: Math.pow(a, b) };
});
//---------------------------------------------------------
// AST and compiler
//---------------------------------------------------------
// view: view, kind[union|query|table]
// action: view, action, kind[select|calculate|project|union|ununion|stateful|limit|sort|group|aggregate], ix
// action source: action, source view
// action mapping: action, from, to source, to field
// action mapping constant: action, from, value
function addRecompileTriggers(eve) {
    var recompileTrigger = {
        exec: function (ixer) {
            for (var _i = 0, _a = ixer.find("view"); _i < _a.length; _i++) {
                var view = _a[_i];
                if (view.kind === "table")
                    continue;
                try {
                    var query = compile(ixer, view.view);
                    ixer.asView(query);
                }
                catch (e) {
                    console.error("BAD QUERY IN THE DB :(");
                    console.error("View Id: " + view.view);
                    console.log(e.stack);
                    ixer.applyDiff(Query.remove(view.view, ixer));
                }
            }
            return {};
        }
    };
    eve.addTable("view", ["view", "kind"]);
    eve.addTable("action", ["view", "action", "kind", "ix"]);
    eve.addTable("action source", ["action", "source view"]);
    eve.addTable("action mapping", ["action", "from", "to source", "to field"]);
    eve.addTable("action mapping constant", ["action", "from", "value"]);
    eve.addTable("action mapping sorted", ["action", "ix", "source", "field", "direction"]);
    eve.addTable("action mapping limit", ["action", "limit type", "value"]);
    eve.table("view").triggers["recompile"] = recompileTrigger;
    eve.table("action").triggers["recompile"] = recompileTrigger;
    eve.table("action source").triggers["recompile"] = recompileTrigger;
    eve.table("action mapping").triggers["recompile"] = recompileTrigger;
    eve.table("action mapping constant").triggers["recompile"] = recompileTrigger;
    eve.table("action mapping sorted").triggers["recompile"] = recompileTrigger;
    eve.table("action mapping limit").triggers["recompile"] = recompileTrigger;
    return eve;
}
function compile(ixer, viewId) {
    var view = ixer.findOne("view", { view: viewId });
    if (!view) {
        throw new Error("No view found for " + viewId + ".");
    }
    var compiled = ixer[view.kind](viewId);
    var actions = ixer.find("action", { view: viewId });
    if (!actions) {
        throw new Error("View " + viewId + " has no actions.");
    }
    // sort actions by ix
    actions.sort(function (a, b) { return a.ix - b.ix; });
    for (var _i = 0; _i < actions.length; _i++) {
        var action = actions[_i];
        var actionKind = action.kind;
        if (actionKind === "limit") {
            var limit = {};
            for (var _a = 0, _b = ixer.find("action mapping limit", { action: action.action }); _a < _b.length; _a++) {
                var limitMapping = _b[_a];
                limit[limitMapping["limit type"]] = limitMapping["value"];
            }
            compiled.limit(limit);
        }
        else if (actionKind === "sort" || actionKind === "group") {
            var sorted = [];
            var mappings = ixer.find("action mapping sorted", { action: action.action });
            mappings.sort(function (a, b) { return a.ix - b.ix; });
            for (var _c = 0; _c < mappings.length; _c++) {
                var mapping = mappings[_c];
                sorted.push([mapping["source"], mapping["field"], mapping["direction"]]);
            }
            if (sorted.length) {
                compiled[actionKind](sorted);
            }
            else {
                throw new Error(actionKind + " without any mappings: " + action.action);
            }
        }
        else {
            var mappings = ixer.find("action mapping", { action: action.action });
            var mappingObject = {};
            for (var _d = 0; _d < mappings.length; _d++) {
                var mapping = mappings[_d];
                var source_1 = mapping["to source"];
                var field = mapping["to field"];
                if (actionKind === "union" || actionKind === "ununion") {
                    mappingObject[mapping.from] = [field];
                }
                else {
                    mappingObject[mapping.from] = [source_1, field];
                }
            }
            var constants = ixer.find("action mapping constant", { action: action.action });
            for (var _e = 0; _e < constants.length; _e++) {
                var constant = constants[_e];
                mappingObject[constant.from] = constant.value;
            }
            var source = ixer.findOne("action source", { action: action.action });
            if (!source && actionKind !== "project") {
                throw new Error(actionKind + " action without a source in '" + viewId + "'");
            }
            if (actionKind !== "project") {
                compiled[actionKind](source["source view"], mappingObject, action.action);
            }
            else {
                compiled[actionKind](mappingObject);
            }
        }
    }
    return compiled;
}
exports.compile = compile;
//---------------------------------------------------------
// Public API
//---------------------------------------------------------
exports.SUCCEED = [{ success: true }];
exports.FAIL = [];
function indexer() {
    var ixer = new Indexer();
    addProvenanceTable(ixer);
    addRecompileTriggers(ixer);
    return ixer;
}
exports.indexer = indexer;
if (utils_1.ENV === "browser")
    window["runtime"] = exports;

},{"./utils":19}],16:[function(require,module,exports){
var CodeMirror = require("codemirror");
var utils_1 = require("./utils");
var runtime_1 = require("./runtime");
var richTextEditor_1 = require("./richTextEditor");
var uitk = require("./uitk");
var uitk_1 = require("./uitk");
var app_1 = require("./app");
var parser_1 = require("./parser");
var NLQueryParser_1 = require("./NLQueryParser");
(function (PANE) {
    PANE[PANE["FULL"] = 0] = "FULL";
    PANE[PANE["WINDOW"] = 1] = "WINDOW";
    PANE[PANE["POPOUT"] = 2] = "POPOUT";
})(exports.PANE || (exports.PANE = {}));
var PANE = exports.PANE;
;
var BLOCK;
(function (BLOCK) {
    BLOCK[BLOCK["TEXT"] = 0] = "TEXT";
    BLOCK[BLOCK["PROJECTION"] = 1] = "PROJECTION";
})(BLOCK || (BLOCK = {}));
;
// Because html5 is full of broken promises and broken dreams
var popoutHistory = [];
//------------------------------------------------------------------------------
// State
//------------------------------------------------------------------------------
exports.uiState = {
    widget: {
        search: {},
        table: {},
        collapsible: {},
        attributes: {},
        card: {},
    },
    pane: {},
    prompt: { open: false, paneId: undefined, prompt: undefined },
};
//---------------------------------------------------------
// Utils
//---------------------------------------------------------
// @NOTE: ids must not contain whitespace
function asEntity(raw) {
    var cleaned = raw && ("" + raw).trim();
    if (!cleaned)
        return;
    if (app_1.eve.findOne("entity", { entity: cleaned }))
        return cleaned;
    cleaned = cleaned.toLowerCase();
    if (app_1.eve.findOne("entity", { entity: cleaned }))
        return cleaned; // This can be removed if we remove caps from ids. UUIDv4 does not use caps in ids
    var _a = (app_1.eve.findOne("index name", { name: cleaned }) || {}).id, id = _a === void 0 ? undefined : _a;
    return id;
}
exports.asEntity = asEntity;
function setURL(paneId, contains, replace) {
    var name = uitk.resolveName(contains);
    if (paneId !== "p1")
        return; // @TODO: Make this a constant
    var url;
    if (contains.length === 0)
        url = "#";
    else if (name === contains)
        url = "#/search/" + utils_1.slugify(contains);
    else
        url = "#/" + utils_1.slugify(name) + "/" + utils_1.slugify(contains);
    var state = { paneId: paneId, contains: contains };
    window["states"] = window["states"] || [];
    window["states"].push(state);
    if (replace)
        window.history.replaceState(state, null, url);
    else
        window.history.pushState(state, null, url);
    historyState = state;
    historyURL = url;
}
exports.setURL = setURL;
function inferRepresentation(search, baseParams) {
    if (baseParams === void 0) { baseParams = {}; }
    var params = utils_1.copy(baseParams);
    var entityId = asEntity(search);
    var cleaned = (search && ("" + search).trim().toLowerCase()) || "";
    if (entityId || cleaned.length === 0) {
        params.entity = entityId || utils_1.builtinId("home");
        if (params.entity === utils_1.builtinId("home")) {
            params.unwrapped = true;
        }
        return { rep: "entity", params: params };
    }
    var _a = cleaned.split("|"), rawContent = _a[0], rawParams = _a[1];
    var parsedParams = getCellParams(rawContent, rawParams);
    params = utils_1.mergeObject(params, parsedParams);
    if (params.rep === "table") {
        params.search = cleaned;
    }
    return { rep: params.rep, params: params };
}
function staticOrMappedTable(search, params) {
    var parsed = NLQueryParser_1.parse(search);
    var topParse = parsed[0];
    params.rep = "table";
    params.search = search;
    // @NOTE: This requires the first project to be the main result of the search
    params.fields = topParse.query.projects[0].fields.map(function (field) { return field.name; });
    params.groups = topParse.context.groupings.map(function (group) { return group.name; });
    //params.fields = uitk.getFields({example: results[0], blacklist: ["__id"]});
    if (!topParse)
        return params;
    // Must not contain any primitive relations
    var editable = true;
    var subject;
    var entity;
    var fieldMap = {};
    var collections = [];
    for (var ctx in topParse.context) {
        if (ctx === "attributes" || ctx === "entities" || ctx === "collections")
            continue;
        for (var _i = 0, _a = topParse.context[ctx]; _i < _a.length; _i++) {
            var node = _a[_i];
            if (node.project) {
                editable = false;
                break;
            }
        }
    }
    // Number of subjects (projected entities or collections) must be 1.
    if (editable) {
        for (var _b = 0, _c = topParse.context.collections; _b < _c.length; _b++) {
            var node = _c[_b];
            var coll = node.collection;
            if (coll.project) {
                if (subject) {
                    editable = false;
                    break;
                }
                else {
                    subject = coll.displayName;
                }
            }
            collections.push(coll.id);
        }
    }
    if (editable) {
        for (var _d = 0, _e = topParse.context.entities; _d < _e.length; _d++) {
            var node = _e[_d];
            var ent = node.entity;
            if (ent.project) {
                if (subject) {
                    editable = false;
                    break;
                }
                else {
                    subject = ent.displayName;
                    entity = ent.id;
                }
            }
        }
    }
    if (editable) {
        for (var _f = 0, _g = topParse.context.attributes; _f < _g.length; _f++) {
            var node = _g[_f];
            var attr = node.attribute;
            if (attr.project) {
                fieldMap[attr.displayName] = attr.id;
            }
        }
        if (entity && Object.keys(fieldMap).length !== 1)
            editable = false;
    }
    if (editable) {
        params.rep = "mappedTable";
        params.subject = subject;
        params.entity = entity;
        params.fieldMap = fieldMap;
        params.collections = collections;
        console.log("MAPPED PARAMS", params);
        return params;
    }
    return params;
}
//---------------------------------------------------------
// Dispatches
//---------------------------------------------------------
app_1.handle("ui update search", function (changes, _a) {
    var paneId = _a.paneId, value = _a.value;
    var state = exports.uiState.widget.search[paneId] = exports.uiState.widget.search[paneId] || { value: value };
    state.value = value;
});
app_1.handle("ui focus search", function (changes, _a) {
    var paneId = _a.paneId, value = _a.value;
    var state = exports.uiState.widget.search[paneId] = exports.uiState.widget.search[paneId] || { value: value };
    state.focused = true;
});
// @TODO: abstract (search) => {rep, params} fn and use it to infer {rep, params} for set pane and set popout.
// @TODO: Update pane(paneId) to take the actual pane fact so it's not tied to the DB.
// @TODO: Update pane(pane) to just directly call represent with the pane's facts.
app_1.handle("set pane", function (changes, info) {
    // Infer valid rep and params if search has changed
    if (info.contains !== undefined && !info.rep) {
        var inferred = inferRepresentation(info.contains, typeof info.params === "string" ? parseParams(info.params) : info.params);
        info.rep = inferred.rep;
        info.params = inferred.params;
        if (!info.rep)
            throw new Error("Could not infer a valid representation for search '" + info.contains + "' in pane '" + info.paneId + "'");
    }
    // Fill missing properties from the previous fact, if present
    var prev = app_1.eve.findOne("ui pane", { pane: info.paneId }) || {};
    var paneId = info.paneId, _a = info.kind, kind = _a === void 0 ? prev.kind : _a, _b = info.rep, rep = _b === void 0 ? prev.rep : _b, _c = info.contains, raw = _c === void 0 ? prev.contains : _c, _d = info.params, rawParams = _d === void 0 ? prev.params : _d, _e = info.popState, popState = _e === void 0 ? false : _e;
    if (kind === undefined || rep == undefined || raw === undefined || rawParams === undefined) {
        throw new Error("Cannot create new pane without all parameters specified for pane '" + paneId + "'");
    }
    var contains = asEntity(raw) || ("" + raw).trim();
    var params = typeof rawParams === "object" ? stringifyParams(rawParams) : rawParams || "";
    var state = exports.uiState.widget.search[paneId] = exports.uiState.widget.search[paneId] || { value: contains, focused: false };
    state.value = contains;
    state.focused = false;
    app_1.dispatch("remove pane", { paneId: paneId }, changes);
    changes.add("ui pane", { pane: paneId, kind: kind, rep: rep, contains: contains, params: params });
    // @TODO: Make "p1" a constant
    if (paneId === "p1") {
        popoutHistory = [];
        if (!popState)
            setURL(paneId, contains);
    }
});
app_1.handle("remove pane", function (changes, _a) {
    var paneId = _a.paneId;
    var children = app_1.eve.find("ui pane parent", { parent: paneId });
    for (var _i = 0; _i < children.length; _i++) {
        var child = children[_i].pane;
        app_1.dispatch("remove pane", { paneId: child }, changes);
    }
    changes.remove("ui pane", { pane: paneId })
        .remove("ui pane position", { pane: paneId })
        .remove("ui pane parent", { parent: paneId })
        .remove("ui pane parent", { pane: paneId });
});
app_1.handle("set popout", function (changes, info) {
    // Recycle the parent's existing popout if it exists, otherwise create a new one
    var parentId = info.parentId;
    var paneId = utils_1.uuid();
    var children = app_1.eve.find("ui pane parent", { parent: parentId });
    var parent = app_1.eve.findOne("ui pane", { pane: parentId });
    var reusing = false;
    if (parent && parent.kind === PANE.POPOUT) {
        reusing = true;
        paneId = parentId;
        parentId = app_1.eve.findOne("ui pane parent", { pane: parentId }).parent;
    }
    else if (children.length) {
        //check if there is already a child popout
        for (var _i = 0; _i < children.length; _i++) {
            var childRel = children[_i];
            var child = app_1.eve.findOne("ui pane", { pane: childRel.pane });
            if (child.kind === PANE.POPOUT) {
                paneId = child.pane;
                break;
            }
        }
    }
    // Infer valid rep and params if search has changed
    if (info.contains && !info.rep) {
        var inferred = inferRepresentation(info.contains, typeof info.params === "string" ? parseParams(info.params) : info.params);
        info.rep = inferred.rep;
        info.params = inferred.params;
        if (!info.rep)
            throw new Error("Could not infer a valid representation for search '" + info.contains + "' in popout '" + paneId + "'");
    }
    // Fill missing properties from the previous fact, if present
    var prev = app_1.eve.findOne("ui pane", { pane: paneId }) || {};
    var prevPos = app_1.eve.findOne("ui pane position", { pane: paneId }) || {};
    var _a = info.rep, rep = _a === void 0 ? prev.rep : _a, _b = info.contains, raw = _b === void 0 ? prev.contains : _b, _c = info.params, rawParams = _c === void 0 ? prev.params : _c, _d = info.x, x = _d === void 0 ? prevPos.x : _d, _e = info.y, y = _e === void 0 ? prevPos.y : _e, _f = info.popState, popState = _f === void 0 ? false : _f;
    if (rep === undefined || raw === undefined || rawParams === undefined || x === undefined || y === undefined) {
        throw new Error("Cannot create new popout without all parameters specified for pane '" + paneId + "'");
    }
    if (reusing) {
        x = prevPos.x;
        y = prevPos.y;
    }
    var params = typeof rawParams === "string" ? rawParams : stringifyParams(rawParams);
    var contains = asEntity(raw) || ("" + raw).trim();
    if (!popState && prev.pane)
        popoutHistory.push({ rep: prev.rep, contains: prev.contains, params: prev.params, x: prevPos.x, y: prevPos.y });
    app_1.dispatch("remove pane", { paneId: paneId }, changes);
    changes.add("ui pane", { pane: paneId, kind: PANE.POPOUT, rep: rep, contains: contains, params: params })
        .add("ui pane parent", { parent: parentId, pane: paneId })
        .add("ui pane position", { pane: paneId, x: x, y: y });
});
// @TODO: take parentId
app_1.handle("remove popup", function (changes, _a) {
    var popup = app_1.eve.findOne("ui pane", { kind: PANE.POPOUT });
    if (popup)
        app_1.dispatch("remove pane", { paneId: popup.pane }, changes);
    popoutHistory = [];
});
app_1.handle("ui toggle search plan", function (changes, _a) {
    var paneId = _a.paneId;
    var state = exports.uiState.widget.search[paneId] = exports.uiState.widget.search[paneId] || { value: "" };
    state.plan = !state.plan;
});
app_1.handle("add sourced eav", function (changes, eav) {
    var entity = eav.entity, attribute = eav.attribute, value = eav.value, source = eav.source, forceEntity = eav.forceEntity;
    if (!source) {
        source = utils_1.uuid();
    }
    var valueId = asEntity(value);
    var coerced = utils_1.coerceInput(value);
    var strValue = value.toString().trim();
    if (valueId) {
        value = valueId;
    }
    else if (strValue[0] === '"' && strValue[strValue.length - 1] === '"') {
        value = JSON.parse(strValue);
    }
    else if (typeof coerced === "number") {
        value = coerced;
    }
    else if (forceEntity || attribute === "is a") {
        var newEntity = utils_1.uuid();
        var pageId = utils_1.uuid();
        changes.dispatch("create page", { page: pageId, content: "" })
            .dispatch("create entity", { entity: newEntity, name: strValue, page: pageId });
        value = newEntity;
    }
    else {
        value = coerced;
    }
    changes.add("sourced eav", { entity: entity, attribute: attribute, value: value, source: source });
});
app_1.handle("remove sourced eav", function (changes, eav) {
    changes.remove("sourced eav", eav);
});
app_1.handle("update page", function (changes, _a) {
    var page = _a.page, content = _a.content;
    changes.remove("page content", { page: page });
    changes.add("page content", { page: page, content: content });
    // let trimmed = content.trim();
    // let endIx = trimmed.indexOf("\n");
    // let name = trimmed.slice(1, endIx !== -1 ? endIx : undefined).trim();
    // let {entity} = eve.findOne("entity page", {page});
    // let {name:prevName = undefined} = eve.findOne("display name", {id: entity}) || {};
    // if(name !== prevName) {
    //   changes.remove("display name", {id: entity, name: prevName});
    //   changes.add("display name", {id: entity, name});
    //   let parts = getLocation().split("/");
    //   if(parts.length > 2 && parts[2].replace(/_/gi, " ") === entity) {
    //     window.history.replaceState(window.history.state, null, `/${slugify(name)}/${slugify(entity)}`);
    //   }
    // }
});
app_1.handle("create entity", function (changes, _a) {
    var entity = _a.entity, page = _a.page, _b = _a.name, name = _b === void 0 ? "Untitled" : _b;
    changes
        .add("entity page", { entity: entity, page: page })
        .add("display name", { id: entity, name: name });
});
app_1.handle("create page", function (changes, _a) {
    var page = _a.page, _b = _a.content, content = _b === void 0 ? undefined : _b;
    if (content === undefined)
        content = "This page is empty. Type something to add some content!";
    changes.add("page content", { page: page, content: content });
});
app_1.handle("create query", function (changes, _a) {
    var id = _a.id, content = _a.content;
    var page = utils_1.uuid();
    changes
        .add("page content", { page: page, content: "#" + content + " query" })
        .add("entity page", { id: id, page: page })
        .add("display name", { id: id, content: content })
        .add("sourced eav", { entity: id, attribute: "is a", value: utils_1.builtinId("query") })
        .add("sourced eav", { entity: id, attribute: "content", value: content });
    var artifacts = parser_1.parseDSL(content);
    if (artifacts.changeset)
        changes.merge(artifacts.changeset);
    for (var viewId in artifacts.views) {
        changes.add("sourced eav", { entity: id, attribute: "artifact", value: viewId });
        var name_1 = artifacts.views[viewId]["displayName"];
        if (!app_1.eve.findOne("display name", { id: viewId }) && name_1)
            changes.add("display name", { id: viewId, name: name_1 });
        changes.merge(artifacts.views[viewId].changeset(app_1.eve));
    }
});
app_1.handle("insert query", function (changes, _a) {
    var query = _a.query;
    query = query.trim().toLowerCase();
    var parsed = NLQueryParser_1.parse(query);
    var topParse = parsed[0];
    if (app_1.eve.findOne("query to id", { query: query }))
        return;
    if (topParse.intent === NLQueryParser_1.Intents.QUERY) {
        var artifacts = parser_1.parseDSL(parsed[0].query.toString());
        if (artifacts.changeset)
            changes.merge(artifacts.changeset);
        var rootId;
        for (var viewId in artifacts.views) {
            if (!rootId)
                rootId = viewId;
            var name_2 = artifacts.views[viewId]["displayName"];
            if (!app_1.eve.findOne("display name", { id: viewId }) && name_2)
                changes.add("display name", { id: viewId, name: name_2 });
            changes.merge(artifacts.views[viewId].changeset(app_1.eve));
        }
        changes.add("query to id", { query: query, id: rootId });
    }
});
app_1.handle("handle setAttribute in a search", function (changes, _a) {
    var attribute = _a.attribute, entity = _a.entity, value = _a.value, replace = _a.replace;
    if (replace) {
        //check if there's a generator, if so, remove that.
        var generated = app_1.eve.find("generated eav", { entity: entity, attribute: attribute });
        if (generated.length) {
            for (var _i = 0; _i < generated.length; _i++) {
                var gen = generated[_i];
                changes.merge(app_1.dispatch("remove attribute generating query", { eav: { entity: entity, attribute: attribute }, view: gen["source"] }));
            }
        }
        else {
            changes.remove("sourced eav", { entity: entity, attribute: attribute });
        }
    }
    changes.merge(app_1.dispatch("add sourced eav", { entity: entity, attribute: attribute, value: value, forceEntity: true }));
});
function dispatchSearchSetAttributes(query, chain) {
    if (!chain) {
        chain = app_1.dispatch();
    }
    var parsed = NLQueryParser_1.parse(query);
    var topParse = parsed[0];
    var isSetSearch = false;
    if (topParse.intent === NLQueryParser_1.Intents.INSERT) {
        // debugger;
        var attributes = [];
        for (var _i = 0, _a = topParse.inserts; _i < _a.length; _i++) {
            var insert = _a[_i];
            // @TODO: NLP needs to tell us whether we're supposed to modify this attribute
            // or if we're just adding a new eav for it.
            var replace = true;
            var entity = insert.entity.entity.id;
            var attribute = void 0;
            if (insert.attribute.attribute) {
                attribute = insert.attribute.attribute.displayName;
            }
            else {
                attribute = insert.attribute.name;
            }
            var value = void 0;
            if (insert.value.type === NLQueryParser_1.NodeTypes.ENTITY) {
                var localValue = insert.value;
                value = localValue.entity.id;
            }
            else if (insert.value.type === NLQueryParser_1.NodeTypes.NUMBER || insert.value.type === NLQueryParser_1.NodeTypes.STRING || insert.value.type === undefined) {
                var localValue = insert.value;
                value = localValue.name;
            }
            if (value === undefined)
                continue;
            chain.dispatch("handle setAttribute in a search", { entity: entity, attribute: attribute, value: value, replace: replace });
            attributes.push("" + attribute);
        }
        query = attributes.join(" and ");
        isSetSearch = true;
    }
    return { chain: chain, query: query, isSetSearch: isSetSearch };
}
// @TODO: there's a lot of duplication between insert query, create query, and insert implication
app_1.handle("insert implication", function (changes, _a) {
    var query = _a.query;
    var artifacts = parser_1.parseDSL(query);
    if (artifacts.changeset)
        changes.merge(artifacts.changeset);
    for (var viewId in artifacts.views) {
        var name_3 = artifacts.views[viewId]["displayName"];
        if (!app_1.eve.findOne("display name", { id: viewId }) && name_3)
            changes.add("display name", { id: viewId, name: name_3 });
        changes.merge(artifacts.views[viewId].changeset(app_1.eve));
    }
});
app_1.handle("remove entity attribute", function (changes, _a) {
    var entity = _a.entity, attribute = _a.attribute, value = _a.value;
    changes.remove("sourced eav", { entity: entity, attribute: attribute, value: value });
    // @FIXME: Make embeds auto-gc themselves when invalidated.
});
app_1.handle("update entity attribute", function (changes, _a) {
    var entity = _a.entity, attribute = _a.attribute, prev = _a.prev, value = _a.value;
    // @FIXME: proper unique source id
    var _b = (app_1.eve.findOne("sourced eav", { entity: entity, attribute: attribute, value: prev }) || {}).source, source = _b === void 0 ? "<global>" : _b;
    if (prev !== undefined)
        changes.remove("sourced eav", { entity: entity, attribute: attribute, value: prev });
    changes.add("sourced eav", { entity: entity, attribute: attribute, value: value, source: source });
});
app_1.handle("rename entity attribute", function (changes, _a) {
    var entity = _a.entity, attribute = _a.attribute, prev = _a.prev, value = _a.value;
    // @FIXME: proper unique source id
    var _b = (app_1.eve.findOne("sourced eav", { entity: entity, attribute: prev, value: value }) || {}).source, source = _b === void 0 ? "<global>" : _b;
    if (prev !== undefined)
        changes.remove("sourced eav", { entity: entity, attribute: prev, value: value });
    changes.add("sourced eav", { entity: entity, attribute: attribute, value: value, source: source });
});
app_1.handle("sort table", function (changes, _a) {
    var state = _a.state, field = _a.field, direction = _a.direction;
    if (field !== undefined) {
        state.sortField = field;
        state.sortDirection = 1;
    }
    if (direction !== undefined)
        state.sortDirection = direction;
});
app_1.handle("toggle settings", function (changes, _a) {
    var paneId = _a.paneId, _b = _a.open, open = _b === void 0 ? undefined : _b;
    var state = exports.uiState.pane[paneId] || { settings: false };
    state.settings = open !== undefined ? open : !state.settings;
    exports.uiState.pane[paneId] = state;
});
app_1.handle("toggle collapse", function (changes, _a) {
    var collapsible = _a.collapsible, _b = _a.open, open = _b === void 0 ? undefined : _b;
    var state = exports.uiState.widget.collapsible[collapsible] || { open: false };
    state.open = open !== undefined ? open : !state.open;
    exports.uiState.widget.collapsible[collapsible] = state;
});
app_1.handle("toggle prompt", function (changes, _a) {
    var _b = _a.prompt, prompt = _b === void 0 ? undefined : _b, _c = _a.paneId, paneId = _c === void 0 ? undefined : _c, _d = _a.open, open = _d === void 0 ? undefined : _d;
    var state = exports.uiState.prompt;
    if (state.prompt !== prompt) {
        state.prompt = prompt;
        state.open = open !== undefined ? open : true;
        state.paneId = paneId;
    }
    else {
        state.open !== undefined ? open : !state.open;
    }
    exports.uiState.prompt = state;
});
app_1.handle("remove entity", function (changes, _a) {
    var entity = _a.entity;
    changes.remove("sourced eav", { entity: entity })
        .remove("display name", { id: entity })
        .remove("manual eavs", { entity: entity })
        .remove("entity page", { entity: entity });
});
//---------------------------------------------------------
// Wiki Containers
//---------------------------------------------------------
function root() {
    var panes = [];
    for (var _i = 0, _a = app_1.eve.find("ui pane"); _i < _a.length; _i++) {
        var paneId = _a[_i].pane;
        panes.push(pane(paneId));
    }
    if (exports.uiState.prompt.open && exports.uiState.prompt.prompt && !exports.uiState.prompt.paneId) {
        panes.push({ c: "shade", click: closePrompt, children: [
                exports.uiState.prompt.prompt()
            ] });
    }
    if (!localStorage["hideBanner"]) {
        panes.unshift({ c: "banner", children: [
                { c: "content", children: [
                        { text: "This is a preview release of Eve meant for " },
                        { t: "a", c: "link", href: "https://groups.google.com/forum/#!forum/eve-talk", text: "feedback" },
                        { text: ". We're shooting for quality over quantity, so please don't post this to HN, Reddit, etc, but feel free to share it with friends." },
                    ] },
                { c: "flex-grow spacer" },
                { t: "button", c: "ion-close", click: hideBanner }
            ] });
    }
    panes.unshift({ c: "feedback-bar", children: [
            { t: "a", target: "_blank", href: "https://github.com/witheve/Eve/issues", text: "bugs" },
            { t: "a", target: "_blank", href: "https://groups.google.com/forum/#!forum/eve-talk", text: "suggestions" },
            { t: "a", target: "_blank", href: "https://groups.google.com/forum/#!forum/eve-talk", text: "discussion" },
        ] });
    return { c: "wiki-root", id: "root", children: panes, click: removePopup };
}
exports.root = root;
function hideBanner(event, elem) {
    localStorage["hideBanner"] = true;
}
// @TODO: Add search functionality + Pane Chrome
var paneChrome = (_a = {},
    _a[PANE.FULL] = function (paneId, entityId) { return ({
        c: "fullscreen",
        header: { t: "header", c: "flex-row", children: [
                // {c: "logo eve-logo", data: {paneId}, link: "", click: navigate},
                searchInput(paneId, entityId),
                { c: "controls visible", children: [
                        { c: "ion-gear-a toggle-settings", style: "font-size: 1.35em;", prompt: paneSettings, paneId: paneId, click: openPrompt }
                    ] }
            ] }
    }); },
    _a[PANE.POPOUT] = function (paneId, entityId) {
        var parent = app_1.eve.findOne("ui pane parent", { pane: paneId })["parent"];
        return {
            c: "window",
            captureClicks: true,
            header: { t: "header", c: "", children: [
                    { t: "button", c: "ion-android-open", click: navigateParent, link: entityId, paneId: paneId, parentId: parent, text: "" },
                ] },
        };
    },
    _a[PANE.WINDOW] = function (paneId, entityId) { return ({
        c: "window",
        header: { t: "header", c: "flex-row", children: [
                { c: "flex-grow title", text: entityId },
                { c: "flex-row controls", children: [
                        { c: "ion-android-search" },
                        { c: "ion-minus-round" },
                        { c: "ion-close-round" }
                    ] }
            ] }
    }); },
    _a
);
function openPrompt(event, elem) {
    app_1.dispatch("toggle prompt", { prompt: elem.prompt, paneId: elem.paneId, open: true }).commit();
}
function closePrompt(event, elem) {
    if (event.target === event.currentTarget) {
        app_1.dispatch("toggle prompt", { open: false }).commit();
    }
}
function navigateParent(event, elem) {
    app_1.dispatch("remove popup", { paneId: elem.paneId })
        .dispatch("set pane", { paneId: elem.parentId, contains: elem.link })
        .commit();
}
function removePopup(event, elem) {
    if (!event.defaultPrevented) {
        var chain = app_1.dispatch("remove popup", {}).dispatch("clearActiveCells", {});
        for (var entity in exports.uiState.widget.attributes) {
            chain.dispatch("clearActiveAttribute", { entity: entity });
        }
        chain.commit();
    }
}
function loadFromFile(event, elem) {
    var target = event.target;
    if (!target.files.length)
        return;
    if (target.files.length > 1)
        throw new Error("Cannot load multiple files at once");
    var file = target.files[0];
    var reader = new FileReader();
    reader.onload = function (event) {
        var serialized = event.target.result;
        app_1.eve.load(serialized);
        app_1.dispatch("toggle prompt", { prompt: loadedPrompt, open: true }).commit();
    };
    reader.readAsText(file);
}
function deleteDatabasePrompt() {
    return { c: "modal-prompt delete-prompt", children: [
            { t: "header", c: "flex-row", children: [
                    { t: "h2", text: "DELETE DATABASE" },
                    { c: "flex-grow" },
                    { c: "controls", children: [{ c: "ion-close-round", click: closePrompt }] }
                ] },
            { c: "info", text: "This will remove all information currently stored in Eve for you and cannot be undone." },
            { c: "flex-row", children: [
                    { t: "button", c: "delete-btn", text: "DELETE EVERYTHING FOREVER", click: nukeDatabase },
                    { c: "flex-grow" },
                    { t: "button", text: "Cancel", click: closePrompt },
                ] }
        ] };
}
function nukeDatabase() {
    localStorage.clear();
    window.location.reload();
}
function savePrompt() {
    var serialized = localStorage[app_1.eveLocalStorageKey];
    return { c: "modal-prompt save-prompt", children: [
            { t: "header", c: "flex-row", children: [
                    { t: "h2", text: "Save DB" },
                    { c: "flex-grow" },
                    { c: "controls", children: [{ c: "ion-close-round", click: closePrompt }] }
                ] },
            { t: "a", href: "data:application/octet-stream;charset=utf-16le;base64," + btoa(serialized), download: "save.evedb", text: "save to file" }
        ] };
}
function loadPrompt() {
    var serialized = localStorage[app_1.eveLocalStorageKey];
    return { c: "modal-prompt load-prompt", children: [
            { t: "header", c: "flex-row", children: [
                    { t: "h2", text: "Load DB" },
                    { c: "flex-grow" },
                    { c: "controls", children: [{ c: "ion-close-round", click: closePrompt }] }
                ] },
            { t: "p", children: [
                    { t: "span", text: "WARNING: This will overwrite your current database. This is irreversible. You should consider " },
                    { t: "a", text: "saving your DB", prompt: savePrompt, click: openPrompt },
                    { t: "span", text: " first." }
                ] },
            { t: "input", type: "file", text: "load from file", change: loadFromFile }
        ] };
}
function loadedPrompt() {
    return { c: "modal-prompt load-prompt", children: [
            { t: "header", c: "flex-row", children: [
                    { t: "h2", text: "Load DB" },
                    { c: "flex-grow" },
                    { c: "controls", children: [{ c: "ion-close-round", click: closePrompt }] }
                ] },
            { text: "Successfully loaded DB from file" }
        ] };
}
function pane(paneId) {
    // @FIXME: Add kind to ui panes
    var _a = app_1.eve.findOne("ui pane", { pane: paneId }) || {}, _b = _a.contains, rawContains = _b === void 0 ? undefined : _b, _c = _a.kind, kind = _c === void 0 ? PANE.FULL : _c, _d = _a.rep, rep = _d === void 0 ? undefined : _d, _e = _a.params, rawParams = _e === void 0 ? undefined : _e;
    var _f = queryUIInfo(rawContains || "home"), results = _f.results, parsedParams = _f.params, contains = _f.content;
    var params = utils_1.mergeObject(parseParams(rawParams), parsedParams);
    params.paneId = paneId;
    var makeChrome = paneChrome[kind];
    if (!makeChrome)
        throw new Error("Unknown pane kind: '" + kind + "' (" + PANE[kind] + ")");
    var _g = makeChrome(paneId, contains), klass = _g.c, header = _g.header, footer = _g.footer, captureClicks = _g.captureClicks;
    var entityId = asEntity(contains);
    var content;
    var contentType = "invalid";
    if (contains.length === 0 || entityId)
        contentType = "entity";
    else if (app_1.eve.findOne("query to id", { query: contains }))
        contentType = "search";
    if (params.rep || rep) {
        content = represent(contains, params.rep || rep, results, params, (params.unwrapped ? undefined : function (elem, ix) { return uitk.card({ id: paneId + "|" + contains + "|" + (ix === undefined ? "" : ix), children: [elem] }); }));
        content.t = "content";
        content.c = (content.c || "") + " " + (params.unwrapped ? "unwrapped" : "");
    }
    var disambiguation;
    if (contentType === "invalid") {
        disambiguation = { c: "flex-row spaced-row disambiguation", children: [
                { t: "span", text: "I couldn't find anything; should I" },
                { t: "a", c: "link btn add-btn", text: "add " + contains, name: contains, paneId: paneId, click: createPage },
                { t: "span", text: "?" },
            ] };
        content = undefined;
    }
    else if (contentType === "search") {
        // @TODO: This needs to move into Eve's notification / chat bar
        disambiguation = { id: "search-disambiguation", c: "flex-row spaced-row disambiguation", children: [
                { text: "Or should I" },
                { t: "a", c: "link btn add-btn", text: "add a card", name: contains, paneId: paneId, click: createPage },
                { text: "for " + contains + "?" }
            ] };
    }
    var scroller = content;
    if (kind === PANE.FULL) {
        scroller = { c: "scroller", children: [
                { c: "top-scroll-fade" },
                content,
                { c: "bottom-scroll-fade" },
            ] };
    }
    var pane = { c: "wiki-pane " + (klass || ""), paneId: paneId, children: [header, disambiguation, scroller, footer] };
    var pos = app_1.eve.findOne("ui pane position", { pane: paneId });
    if (pos) {
        pane.style = "left: " + (isNaN(pos.x) ? pos.x : pos.x + "px") + "; top: " + (isNaN(pos.y) ? pos.y : (pos.y + 20) + "px") + ";";
    }
    if (captureClicks) {
        pane.click = uitk_1.preventDefault;
    }
    if (exports.uiState.prompt.open && exports.uiState.prompt.paneId === paneId) {
        pane.children.push({ c: "shade", paneId: paneId, click: closePrompt }, exports.uiState.prompt.prompt(paneId));
    }
    return pane;
}
exports.pane = pane;
function search(search, paneId) {
    var _a = search.split("|"), rawContent = _a[0], rawParams = _a[1];
    var parsedParams = getCellParams(rawContent, rawParams);
    var _b = queryUIInfo(search), results = _b.results, params = _b.params, content = _b.content;
    params["paneId"] = paneId;
    utils_1.mergeObject(params, parsedParams);
    var rep = represent(content, params["rep"], results, params);
    return { t: "content", c: "wiki-search", children: [
            rep
        ] };
}
exports.search = search;
function createPage(evt, elem) {
    var name = elem["name"];
    var entity = utils_1.uuid();
    var page = utils_1.uuid();
    app_1.dispatch("create page", { page: page, content: "" })
        .dispatch("create entity", { entity: entity, page: page, name: name })
        .dispatch("set pane", { paneId: elem["paneId"], contains: entity, rep: "entity", params: "" }).commit();
}
function deleteEntity(event, elem) {
    var name = uitk.resolveName(elem.entity);
    app_1.dispatch("remove entity", { entity: elem.entity }).commit();
    app_1.dispatch("set pane", { paneId: elem.paneId, contains: name }).commit();
}
function paneSettings(paneId) {
    var pane = app_1.eve.findOne("ui pane", { pane: paneId });
    var _a = (app_1.eve.findOne("entity", { entity: uitk.resolveId(pane.contains) }) || {}).entity, entity = _a === void 0 ? undefined : _a;
    var isSystem = !!(entity && app_1.eve.findOne("entity eavs", { entity: entity, attribute: "is a", value: utils_1.builtinId("system") }));
    return { t: "ul", c: "settings", children: [
            { t: "li", c: "save-btn", text: "save", prompt: savePrompt, click: openPrompt },
            { t: "li", c: "load-btn", text: "load", prompt: loadPrompt, click: openPrompt },
            entity && !isSystem ? { t: "li", c: "delete-btn", text: "delete card", entity: entity, paneId: paneId, click: deleteEntity } : undefined,
            { t: "li", c: "delete-btn", text: "DELETE DATABASE", prompt: deleteDatabasePrompt, click: openPrompt },
        ] };
}
function sizeColumns(node, elem) {
    // @FIXME: Horrible hack to get around randomly added "undefined" text node that's coming from in microreact.
    var cur = node;
    while (cur.parentElement)
        cur = cur.parentElement;
    if (cur.tagName !== "HTML")
        document.body.appendChild(cur);
    var child, ix = 0;
    var widths = {};
    var columns = node.querySelectorAll(".column");
    for (var _i = 0; _i < columns.length; _i++) {
        var column = columns[_i];
        column.style.width = "auto";
        widths[column["value"]] = widths[column["value"]] || 0;
        if (column.offsetWidth > widths[column["value"]])
            widths[column["value"]] = column.offsetWidth;
    }
    for (var _a = 0; _a < columns.length; _a++) {
        var column = columns[_a];
        column.style.width = widths[column["value"]] + 1;
    }
    if (cur.tagName !== "HTML")
        document.body.removeChild(cur);
}
//---------------------------------------------------------
// Wiki editor functions
//---------------------------------------------------------
function parseParams(rawParams) {
    var params = {};
    if (!rawParams)
        return params;
    for (var _i = 0, _a = rawParams.split(";"); _i < _a.length; _i++) {
        var kv = _a[_i];
        var _b = kv.split("="), key = _b[0], value = _b[1];
        if (!key || !key.trim())
            continue;
        value = value.trim();
        if (!value)
            throw new Error("Must specify value for key '" + key + "'");
        if (value[0] === "{" && value[value.length - 1] === "}" || value[0] === "[" && value[value.length - 1] === "]") {
            try {
                var result = JSON.parse(value);
                value = result;
            }
            catch (err) { }
        }
        params[key.trim()] = utils_1.coerceInput(value);
    }
    return params;
}
function stringifyParams(params) {
    var rawParams = "";
    if (!params)
        return rawParams;
    for (var key in params) {
        if (params[key] === undefined || params[key] === null)
            continue;
        rawParams += "" + (rawParams.length ? "; " : "") + key + " = " + (typeof params[key] === "object" ? JSON.stringify(params[key]) : params[key]);
    }
    return rawParams;
}
function cellUI(paneId, query, cell) {
    var _a = queryUIInfo(query), params = _a.params, results = _a.results, content = _a.content;
    params["paneId"] = params["paneId"] || paneId;
    params["cell"] = cell;
    params["childRep"] = params["rep"];
    params["rep"] = "embeddedCell";
    return { c: "cell", children: [represent(content, params["rep"], results, params)] };
}
// Credit to https://mathiasbynens.be/demo/url-regex and @gruber
var urlRegex = /\b(([\w-]+:\/\/?|www[.])[^\s()<>]+(?:\([\w\d]+\)|([^[\.,\-\/#!$%' "^*;:{_`~()\-\s]|\/)))/i;
function queryUIInfo(query) {
    var _a = query.split("|"), content = _a[0], rawParams = _a[1];
    var embedType;
    // let params = getCellParams(content, rawParams);
    var params = parseParams(rawParams);
    var results;
    var entityId = asEntity(content);
    if (entityId) {
        results = { unprojected: [{ entity: entityId }], results: [{ entity: entityId }] };
    }
    else if (urlRegex.exec(content)) {
        results = { unprojected: [{ url: content }], results: [{ url: content }] };
    }
    else {
        var cleaned = content && content.trim().toLowerCase();
        var queryId = app_1.eve.findOne("query to id", { query: cleaned });
        if (queryId) {
            var queryResults = app_1.eve.find(queryId.id);
            var queryUnprojected = app_1.eve.table(queryId.id).unprojected;
            if (!queryResults.length) {
                params["rep"] = "error";
                params["message"] = "No results";
            }
            else {
                results = { unprojected: queryUnprojected, results: queryResults };
            }
        }
        else {
            params["rep"] = "error";
            params["message"] = "invalid search";
        }
    }
    return { results: results, params: params, content: content };
}
function getCellParams(content, rawParams) {
    content = content.trim();
    var params = parseParams(rawParams);
    var entityId = asEntity(content);
    if (entityId) {
        params["rep"] = params["rep"] || "link";
    }
    else if (urlRegex.exec(content)) {
        params["rep"] = params["rep"] || "externalLink";
    }
    else {
        if (params["rep"])
            return params;
        var parsed = NLQueryParser_1.parse(content);
        var currentParse = parsed[0];
        var context = currentParse.context;
        var hasCollections = context.collections.length;
        var field;
        var rep;
        var aggregates = [];
        for (var _i = 0, _a = context.fxns; _i < _a.length; _i++) {
            var fxn = _a[_i];
            if (fxn.fxn.type === NLQueryParser_1.FunctionTypes.AGGREGATE) {
                aggregates.push(fxn);
            }
        }
        var totalFound = 0;
        for (var _b = 0, _c = ["attributes", "entities", "collections", "fxns", "maybeAttributes", "maybeEntities", "maybeCollections", "maybeFunctions"]; _b < _c.length; _b++) {
            var item = _c[_b];
            totalFound += context[item].length;
        }
        if (aggregates.length === 1 && context["groupings"].length === 0) {
            rep = "CSV";
            field = aggregates[0].name;
        }
        else if (!hasCollections && context.fxns.length === 1 && context.fxns[0].fxn.type !== NLQueryParser_1.FunctionTypes.BOOLEAN) {
            rep = "CSV";
            field = context.fxns[0].name;
        }
        else if (!hasCollections && context.attributes.length === 1) {
            rep = "CSV";
            field = context.attributes[0].name;
        }
        else if (context.entities.length + context.fxns.length === totalFound) {
            // if there are only entities and boolean functions then we want to show this as cards
            params["rep"] = "entity";
        }
        else if (currentParse.query && currentParse.query.projects.length) {
            staticOrMappedTable(content, params);
        }
        else {
            // Error state, unknown entity
            params["rep"] = "error";
        }
        if (rep) {
            params["rep"] = rep;
            params["field"] = field;
        }
    }
    return params;
}
var paneEditors = {};
function wikiEditor(node, elem) {
    richTextEditor_1.createEditor(node, elem);
    var _a = elem.meta, paneId = _a.paneId, entityId = _a.entityId;
    paneEditors[(paneId + "|" + entityId)] = node.editor;
}
exports.wikiEditor = wikiEditor;
function reparentCell(node, elem) {
    if (node.parentNode.id !== elem.containerId) {
        document.getElementById(elem.containerId).appendChild(node);
    }
    node.parentNode["mark"].changed();
}
function focusCellEditor(node, elem) {
    utils_1.autoFocus(node, elem);
    if (!node.didFocus) {
        node.didFocus = true;
        utils_1.setEndOfContentEditable(node);
    }
}
//---------------------------------------------------------
function cellEditor(entityId, paneId, cell) {
    var text = exports.activeCells[cell.id].query;
    var _a = autocompleterOptions(entityId, paneId, cell), options = _a.options, selected = _a.selected;
    var autoFocus = true;
    if (text.match(/\$\$.*\$\$/)) {
        text = "";
    }
    var _b = (app_1.eve.findOne("display name", { id: text }) || {}).name, name = _b === void 0 ? undefined : _b;
    if (name) {
        text = name;
    }
    return { children: [
            { c: "embedded-cell", children: [
                    { c: "adornment", text: "=" },
                    { t: "span", c: "", contentEditable: true, text: text, click: uitk_1.preventDefault, input: updateActiveCell, keydown: embeddedCellKeys, cell: cell, selected: selected, paneId: paneId, postRender: autoFocus ? focusCellEditor : undefined },
                ] },
            autocompleter(options, paneId, cell)
        ] };
}
function autocompleter(options, paneId, cell) {
    var children = [];
    for (var _i = 0; _i < options.length; _i++) {
        var option = options[_i];
        var item = { c: "option", children: option.children, text: option.text, selected: option, cell: cell, paneId: paneId, click: executeAutocompleterOption, keydown: optionKeys };
        if (option.selected) {
            item.c += " selected";
        }
        children.push(item);
    }
    return { c: "autocompleter", key: performance.now().toString(), cell: cell, containerId: paneId + "|" + cell.id + "|container", children: children, postRender: positionAutocompleter };
}
function optionKeys(event, elem) {
    if (event.keyCode === utils_1.KEYS.ENTER) {
        executeAutocompleterOption(event.currentTarget, elem);
    }
}
function executeAutocompleterOption(event, elem) {
    if (event.defaultPrevented)
        return;
    var paneId = elem.paneId, cell = elem.cell;
    var editor = paneEditors[cell.editorId];
    var cm = editor.cmInstance;
    var mark = editor.marks[cell.id];
    var doEmbed = makeDoEmbedFunction(cm, mark, cell, paneId);
    if (elem.selected && elem.selected.action) {
        if (typeof elem.selected.action === "function") {
            elem.selected.action(elem, cell.query, doEmbed);
        }
    }
}
function autocompleterOptions(entityId, paneId, cell) {
    var _a = cell.query.trim().split("|"), text = _a[0], rawParams = _a[1];
    if (text.match(/\$\$.*\$\$/)) {
        return { options: [], selected: {} };
    }
    var params = {};
    try {
        params = getCellParams(text, rawParams);
    }
    catch (e) {
    }
    var contentEntityId = asEntity(text);
    if (contentEntityId) {
        text = uitk.resolveName(contentEntityId);
    }
    var isEntity = app_1.eve.findOne("display name", { id: contentEntityId });
    var parsed = [];
    if (text !== "") {
        try {
            parsed = NLQueryParser_1.parse(text); // @TODO: this should come from the NLP parser once it's hooked up.
        }
        catch (e) {
        }
    }
    // the autocomplete can have multiple states
    var state = cell.state || "query";
    // every option has a score for how pertinent it is
    // things with a score of 0 will be filtered, everything else
    // will be sorted descending.
    var options;
    if (state === "query") {
        options = queryAutocompleteOptions(isEntity, parsed, text, params, entityId);
    }
    else if (state === "represent") {
        options = representAutocompleteOptions(isEntity, parsed, text, params, entityId);
    }
    else if (state === "create") {
        options = createAutocompleteOptions(isEntity, parsed, text, params, entityId);
    }
    else if (state === "define") {
        options = defineAutocompleteOptions(isEntity, parsed, text, params, entityId);
    }
    else if (state === "modify") {
        options = modifyAutocompleteOptions(isEntity, parsed, text, params, entityId);
    }
    else if (state === "property") {
        options = propertyAutocompleteOptions(isEntity, parsed, text, params, entityId);
    }
    else if (state === "url") {
        options = urlAutocompleteOptions(isEntity, parsed, text, params, entityId);
    }
    options = options.sort(function (a, b) { return b.score - a.score; });
    var selected;
    if (options.length) {
        var selectedIx = cell.selected % options.length;
        if (selectedIx < 0)
            selectedIx = options.length + selectedIx;
        selected = options[selectedIx];
        selected.selected = true;
    }
    for (var _i = 0; _i < options.length; _i++) {
        var option = options[_i];
        option["cell"] = cell;
        option["paneId"] = paneId;
    }
    return { options: options, selected: selected };
}
function positionAutocompleter(node, elem) {
    var containerId = elem.containerId;
    var container = document.getElementById(containerId);
    var _a = container.getBoundingClientRect(), bottom = _a.bottom, left = _a.left;
    document.body.appendChild(node);
    node.style.top = bottom;
    node.style.left = left;
}
function queryAutocompleteOptions(isEntity, parsed, text, params, entityId) {
    var pageName = uitk.resolveName(entityId);
    var options = [];
    var hasValidParse = parsed.some(function (parse) { return parse.intent === NLQueryParser_1.Intents.QUERY; });
    parsed.sort(function (a, b) { return b.score - a.score; });
    var topOption = parsed[0];
    var joiner = "a";
    if (text && text[0].match(/[aeiou]/i)) {
        joiner = "an";
    }
    var isAttribute = false;
    if (topOption) {
        var totalFound = 0;
        var context = topOption.context;
        for (var item in context) {
            totalFound += context[item].length;
        }
        var isEntAttr = totalFound === 2 && (context.entities.length === 1 || context.collections.length === 1);
        if (isEntAttr && context.maybeAttributes.length === 1) {
            options.push({ score: 4, action: setCellState, state: "define", text: "add " + text });
            isAttribute = true;
        }
        else if (isEntAttr && context.attributes.length === 1) {
            options.push({ score: 2.5, action: setCellState, state: "modify", text: "modify " + text });
        }
    }
    // create
    if (!isEntity && text !== "" && text != "=") {
        options.push({ score: 1, action: setCellState, state: "create", text: "Create " + joiner + " \"" + text + "\" page" });
    }
    // disambiguations
    if (parsed.length > 1) {
        options.push({ score: 3, action: "disambiguate stuff", text: "DISAMBIGUATE!" });
    }
    if (!isEntity && hasValidParse && params["rep"]) {
        options.push({ score: 4, action: embedAs, rep: params["rep"], params: params, text: "embed as a " + params["rep"] });
    }
    // repesentation
    // we can only repesent things if we've found them
    if (isEntity || hasValidParse) {
        // @TODO: how do we figure out what representations actually make sense to show?
        options.push({ score: 2, action: setCellState, state: "represent", text: "embed as ..." });
    }
    // set attribute
    if (text && app_1.eve.findOne("index name", { id: entityId }).name !== text.toLowerCase()) {
        if (!isAttribute) {
            options.push({ score: 2.5, action: setCellState, state: "property", text: "add as a property of " + pageName });
        }
        if (isEntity) {
            var isAScore = 2.5;
            if (app_1.eve.findOne("collection", { collection: isEntity.id })) {
                isAScore = 3;
            }
            options.push({ score: 2.5, action: addAttributeAndEmbed, replace: "is a", entityId: entityId, value: isEntity.id, attribute: "related to", text: pageName + " is related to " + text });
            options.push({ score: isAScore, action: addAttributeAndEmbed, replace: "related to", entityId: entityId, value: isEntity.id, attribute: "is a", text: pageName + " is " + joiner + " " + text });
        }
    }
    // url embedding
    if (urlRegex.exec(text)) {
        options.push({ score: 3, action: setCellState, state: "url", text: "embed url as..." });
    }
    return options;
}
function addAttributeAndEmbed(elem, strValue, doEmbed) {
    var _a = elem.selected, entityId = _a.entityId, value = _a.value, attribute = _a.attribute, replace = _a.replace;
    var chain = app_1.dispatch("add sourced eav", { entity: entityId, attribute: attribute, value: value, source: utils_1.uuid() });
    if (replace) {
        chain.dispatch("remove entity attribute", { entity: entityId, attribute: replace, value: value });
    }
    chain.commit();
    doEmbed(value + "|rep=link;");
}
function setCellState(elem, value, doEmbed) {
    app_1.dispatch("setCellState", { id: elem.cell.id, state: elem.selected.state }).commit();
}
function createAutocompleteOptions(isEntity, parsed, text, params, entityId) {
    var options = [];
    var pageName = uitk.resolveName(entityId);
    var isCollection = isEntity ? app_1.eve.findOne("collection", { collection: isEntity.id }) : false;
    var joiner = "a";
    if (text && text[0].match(/[aeiou]/i)) {
        joiner = "an";
    }
    var isAScore = 2.5;
    if (isCollection) {
        isAScore = 3;
    }
    options.push({ score: 2.5, action: createAndEmbed, replace: "is a", entityId: entityId, attribute: "related to", text: pageName + " is related to " + text });
    options.push({ score: isAScore, action: createAndEmbed, replace: "related to", entityId: entityId, attribute: "is a", text: pageName + " is " + joiner + " " + text });
    return options;
}
function createAndEmbed(elem, value, doEmbed) {
    //create the page and embed a link to it
    var entity = utils_1.uuid();
    var page = utils_1.uuid();
    var _a = elem.selected, entityId = _a.entityId, attribute = _a.attribute, replace = _a.replace;
    var chain = app_1.dispatch("create page", { page: page, content: "" })
        .dispatch("create entity", { entity: entity, page: page, name: value })
        .dispatch("add sourced eav", { entity: entityId, attribute: attribute, value: entity, source: utils_1.uuid() });
    if (replace) {
        chain.dispatch("remove entity attribute", { entity: entityId, attribute: replace, value: entity });
    }
    chain.commit();
    doEmbed(value + "|rep=link;");
}
function representAutocompleteOptions(isEntity, parsed, text, params, entityId) {
    var options = [];
    var isCollection = isEntity ? app_1.eve.findOne("collection", { collection: isEntity.id }) : false;
    options.push({ score: 1, text: "a table", action: embedAs, rep: "table", params: params });
    // options.push({score:1, text: "embed as a value", action: embedAs, rep: "value"});
    if (isEntity) {
        options.push({ score: 1, text: "a link", action: embedAs, rep: "link", params: params });
    }
    if (isCollection) {
        options.push({ score: 1, text: "a list", action: embedAs, rep: "index", params: params });
        options.push({ score: 1, text: "a directory", action: embedAs, rep: "directory", params: params });
    }
    if (isEntity) {
        options.push({ score: 1, text: "a list of related pages", action: embedAs, rep: "related", params: params });
    }
    return options;
}
function urlAutocompleteOptions(isEntity, parsed, url, params, entityId) {
    // @NOTE: url must be normalized before reaching here.
    // @FIXME: Need to get a url property onto the params. Should that be done here?
    var ext = url.slice(url.lastIndexOf(".") + 1).trim().toLowerCase();
    var domain = url.slice(url.indexOf("//") + 2).split("/")[0];
    var isImage = ["png", "jpg", "jpeg", "bmp", "tiff"].indexOf(ext) !== -1;
    var isVideo = (["mp4", "ogv", "webm", "mov", "avi", "flv"].indexOf(ext) !== -1) || (["www.youtube.com", "youtu.be"].indexOf(domain) !== -1);
    var options = [
        { score: 2, text: "a link", action: embedAs, rep: "externalLink", params: params },
        { score: isImage ? 3 : 1, text: "an image", action: embedAs, rep: "externalImage", params: params },
        { score: isVideo ? 3 : 1, text: "a video", action: embedAs, rep: "externalVideo", params: params },
    ];
    return options;
}
function embedAs(elem, value, doEmbed) {
    var text = value.split("|")[0];
    var params = elem.selected.params;
    var rawParams = "rep=" + elem.selected.rep;
    for (var param in params) {
        if (param !== "rep") {
            rawParams += "; " + param + "=" + params[param];
        }
    }
    doEmbed(text + "|" + rawParams);
}
function propertyAutocompleteOptions(isEntity, parsed, text, params, entityId) {
    var options = [];
    var topParse = parsed[0];
    var asQuery = topParse && topParse.intent === NLQueryParser_1.Intents.QUERY;
    var option = { score: 1, action: definePropertyAndEmbed, entityId: entityId, asQuery: asQuery };
    option.children = [
        { c: "attribute-name", text: "property" },
        { c: "inline-cell", contentEditable: true, selected: option, keydown: defineKeys, postRender: utils_1.autoFocus }
    ];
    options.push(option);
    return options;
}
function definePropertyAndEmbed(elem, value, doEmbed) {
    var selected = elem.selected;
    var entityId = selected.entityId, asQuery = selected.asQuery, defineValue = selected.defineValue;
    if (asQuery) {
        value = "= " + value;
    }
    var success = handleAttributeDefinition(entityId, defineValue, value);
    var entityName = uitk.resolveName(entityId);
    doEmbed(entityName + "'s " + defineValue + "|rep=CSV;field=" + defineValue);
}
function defineAutocompleteOptions(isEntity, parsed, text, params, entityId) {
    var options = [];
    var topParse = parsed[0];
    var context = topParse.context;
    var attribute;
    if (context.maybeAttributes[0]) {
        attribute = context.maybeAttributes[0].name;
    }
    else {
        attribute = context.attributes[0].displayName;
    }
    var subject = context.entities[0] || context.collections[0];
    var entity = subject.id;
    var option = { score: 1, action: defineAndEmbed, attribute: attribute, entity: entity };
    option.children = [
        { c: "attribute-name", text: attribute },
        { c: "inline-cell", contentEditable: true, selected: option, keydown: defineKeys, postRender: utils_1.autoFocus }
    ];
    options.push(option);
    return options;
}
function focusSelected(node, elem) {
    if (elem.selected.selected && node !== document.activeElement) {
        node.focus();
        utils_1.setEndOfContentEditable(node);
    }
}
function selectOptionIx(event, elem) {
    event.preventDefault();
    app_1.dispatch("moveCellAutocomplete", { cell: elem.selected.cell, value: elem.optionIx }).commit();
}
function modifyAutocompleteOptions(isEntity, parsed, text, params, entityId) {
    var options = [];
    var topParse = parsed[0];
    var context = topParse.context;
    var attribute = context.attributes[0].displayName;
    var subject = context.entities[0] || context.collections[0];
    var entity = subject.id;
    var eavs = app_1.eve.find("entity eavs", { entity: entity, attribute: attribute });
    var ix = 0;
    var sourcesSeen = {};
    for (var _i = 0; _i < eavs.length; _i++) {
        var eav = eavs[_i];
        var option_1 = { score: 1, action: modifyAndEmbed, eav: eav, params: params };
        var generated = app_1.eve.findOne("generated eav", { entity: eav.entity, attribute: eav.attribute, value: eav.value });
        var text_1 = eav.value;
        var sourceView = void 0;
        var display = app_1.eve.findOne("display name", { id: text_1 });
        if (generated) {
            sourceView = generated.source;
            if (sourcesSeen[sourceView])
                continue;
            sourcesSeen[sourceView] = true;
            text_1 = "= " + app_1.eve.findOne("query to id", { id: sourceView }).query;
            option_1.sourceView = sourceView;
            option_1.query = text_1;
        }
        else if (display) {
            text_1 = "= " + display.name;
        }
        option_1.children = [
            { c: "attribute-name", text: attribute },
            { c: "inline-cell", contentEditable: true, text: text_1, optionIx: ix, click: selectOptionIx, selected: option_1, keydown: defineKeys, postRender: focusSelected }
        ];
        options.push(option_1);
        ix++;
    }
    var option = { score: 1, action: defineAndEmbed, attribute: attribute, entity: entity };
    option.children = [
        { c: "attribute-name", text: attribute },
        { c: "inline-cell", contentEditable: true, selected: option, keydown: defineKeys, postRender: focusSelected }
    ];
    options.push(option);
    return options;
}
function modifyAndEmbed(elem, text, doEmbed) {
    var _a = elem.selected, eav = _a.eav, defineValue = _a.defineValue, params = _a.params, sourceView = _a.sourceView, query = _a.query;
    var success = submitAttribute({ currentTarget: { value: defineValue } }, { eav: eav, sourceView: sourceView, query: query });
    if (!success) {
        console.log("I don't know what to do");
    }
    // if you didn't remove all the attributes, just re-embed what was there
    if (app_1.eve.findOne("entity eavs", { entity: eav.entity, attribute: eav.attribute })) {
        doEmbed(text + "|" + stringifyParams(params));
    }
    else {
        // otherwise there's no point in embedding an error cell
        doEmbed("");
    }
}
function interpretAttributeValue(value) {
    var cleaned = value.trim();
    var isNumber = parseFloat(value);
    if (!isNumber) {
        //parse it
        cleaned = cleaned.trim();
        var entityId = asEntity(cleaned);
        if (entityId) {
            return { isValue: true, value: entityId };
        }
        var parsed = NLQueryParser_1.parse(cleaned);
        return { isValue: false, parse: parsed, value: cleaned };
    }
    else {
        return { isValue: true, value: utils_1.coerceInput(cleaned) };
    }
}
function handleAttributeDefinition(entity, attribute, search, chain) {
    if (!chain) {
        chain = app_1.dispatch();
    }
    var _a = interpretAttributeValue(search), isValue = _a.isValue, value = _a.value, parse = _a.parse;
    console.log("HANDLING", isValue, value, parse);
    if (isValue) {
        chain.dispatch("add sourced eav", { entity: entity, attribute: attribute, value: value }).commit();
    }
    else {
        var queryText = value.trim();
        // add the query
        app_1.dispatch("insert query", { query: queryText }).commit();
        // create another query that projects eavs
        var cleaned = queryText && queryText.trim().toLowerCase();
        var queryToId = app_1.eve.findOne("query to id", { query: cleaned });
        if (!queryToId)
            return false;
        var id = queryToId.id;
        var params = getCellParams(queryText, "");
        if (!params["field"]) {
            return false;
        }
        else {
            //build a query
            var eavProject = "(query :$$view \"" + entity + "|" + attribute + "|" + id + "\" (select \"" + id + "\" :" + params["field"].replace(" ", "-") + " value)\n      (project! \"generated eav\" :entity \"" + entity + "\" :attribute \"" + attribute + "\" :value value :source \"" + id + "\"))";
            chain.dispatch("insert implication", { query: eavProject }).commit();
        }
    }
    return true;
}
function defineAndEmbed(elem, text, doEmbed) {
    var selected = elem.selected;
    var entity = selected.entity, attribute = selected.attribute, defineValue = selected.defineValue;
    var success = handleAttributeDefinition(entity, attribute, defineValue);
    if (success) {
        doEmbed(text + "|rep=CSV;field=" + attribute);
    }
    else {
        console.error("Couldn't figure out subject of: " + defineValue);
        doEmbed(text + "|rep=error;message=I couldn't figure out the subject of that search;");
    }
}
function defineKeys(event, elem) {
    var cell = elem.selected.cell;
    if (event.keyCode === utils_1.KEYS.ENTER) {
        elem.selected.defineValue = event.currentTarget.textContent;
        event.preventDefault();
    }
    else if (event.keyCode === utils_1.KEYS.UP) {
        app_1.dispatch("moveCellAutocomplete", { cell: cell, direction: -1 }).commit();
    }
    else if (event.keyCode === utils_1.KEYS.DOWN) {
        app_1.dispatch("moveCellAutocomplete", { cell: cell, direction: 1 }).commit();
    }
    else if (event.keyCode === utils_1.KEYS.ESC) {
        app_1.dispatch("clearActiveCells").commit();
        if (elem.selected.paneId) {
            paneEditors[cell.editorId].cmInstance.focus();
        }
    }
}
function maybeActivateCell(cm, paneId) {
    if (!cm.somethingSelected()) {
        var pos = cm.getCursor("from");
        var marks = cm.findMarksAt(pos);
        var cell;
        for (var _i = 0; _i < marks.length; _i++) {
            var mark = marks[_i];
            var to = mark.find().to;
            if (mark.cell && to.ch === pos.ch) {
                cell = mark.cell;
                break;
            }
        }
        if (cell) {
            var query = cell.query.split("|")[0];
            app_1.dispatch("addActiveCell", { id: cell.id, cell: cell, query: query }).commit();
            return;
        }
    }
    return CodeMirror.Pass;
}
function maybeNavigate(cm, paneId) {
    if (!cm.somethingSelected()) {
        var pos = cm.getCursor("from");
        var marks = cm.findMarksAt(pos);
        var toClick;
        for (var _i = 0; _i < marks.length; _i++) {
            var mark = marks[_i];
            if (mark.cell) {
                toClick = mark;
            }
        }
        if (toClick) {
            // @HACK: there really should be a better way for me to find out
            // if there's a link in this cell and if it is what that link is
            // to.
            var link = toClick.widgetNode.querySelector(".link");
            if (link) {
                var elem = app_1.renderer.tree[link._id];
                var coords = cm.cursorCoords(true, "page");
                uitk_1.navigate({ clientX: coords.left, clientY: coords.top, preventDefault: function () { } }, elem);
            }
        }
    }
}
exports.activeCells = {};
app_1.handle("clearActiveCells", function (changes, info) {
    for (var cell in exports.activeCells) {
        changes.dispatch("removeActiveCell", exports.activeCells[cell]);
    }
});
app_1.handle("addActiveCell", function (changes, info) {
    changes.dispatch("clearActiveCells", {});
    var id = info.id;
    info.selected = 0;
    info.editorId = info.cell.editorId;
    exports.activeCells[id] = info;
});
app_1.handle("removeActiveCell", function (changes, info) {
    var id = info.id;
    delete exports.activeCells[id];
});
app_1.handle("setCellState", function (changes, info) {
    var active = exports.activeCells[info.id];
    active.selected = 0;
    active.state = info.state;
});
app_1.handle("updateActiveCell", function (changes, info) {
    var active = exports.activeCells[info.id];
    active.query = info.query;
    active.selected = 0;
    active.state = "query";
});
app_1.handle("moveCellAutocomplete", function (changes, info) {
    var active = exports.activeCells[info.cell.id];
    var direction = info.direction, value = info.value;
    if (value === undefined) {
        active.selected += direction;
    }
    else {
        active.selected = value;
    }
});
function updateActiveCell(event, elem) {
    var cell = elem.cell;
    app_1.dispatch("updateActiveCell", { id: cell.id, cell: cell, query: event.currentTarget.textContent }).commit();
}
function activateCell(event, elem) {
    var cell = elem.cell;
    var query = cell.query.split("|")[0];
    app_1.dispatch("addActiveCell", { id: cell.id, cell: cell, query: query }).commit();
    event.preventDefault();
}
function createEmbedPopout(cm, editorId) {
    cm.operation(function () {
        var from = cm.getCursor("from");
        var id = utils_1.uuid();
        cm.replaceRange("=", from, cm.getCursor("to"));
        var to = cm.getCursor("from");
        var fromIx = cm.indexFromPos(from);
        var toIx = cm.indexFromPos(to);
        var cell = { id: id, start: fromIx, length: toIx - fromIx, placeholder: true, query: "", editorId: editorId };
        app_1.dispatch("addActiveCell", { id: id, query: "", cell: cell, placeholder: true });
    });
}
function makeDoEmbedFunction(cm, mark, cell, paneId) {
    return function (value) {
        var _a = mark.find(), from = _a.from, to = _a.to;
        if (value[0] === "=") {
            value = value.substring(1);
        }
        value = value.trim();
        var _b = value.split("|"), text = _b[0], rawParams = _b[1];
        text = text.trim();
        // @TODO: this doesn't take disambiguations into account
        var entityId = asEntity(text);
        if (entityId) {
            text = entityId;
        }
        var replacement = "{" + text + "|" + (rawParams || "") + "}";
        if (text === "") {
            replacement = "";
        }
        if (cm.getRange(from, to) !== replacement) {
            cm.replaceRange(replacement, from, to);
        }
        paneEditors[cell.editorId].cmInstance.focus();
        var chain = app_1.dispatch("removeActiveCell", cell);
        if (replacement) {
            chain.dispatch("insert query", { query: text });
        }
        chain.commit();
    };
}
function embeddedCellKeys(event, elem) {
    var paneId = elem.paneId, cell = elem.cell;
    var target = event.currentTarget;
    var value = target.textContent;
    var editor = paneEditors[cell.editorId];
    var cm = editor.cmInstance;
    var mark = editor.marks[cell.id];
    if (event.keyCode === utils_1.KEYS.BACKSPACE && value === "") {
        var _a = mark.find(), from = _a.from, to = _a.to;
        cm.replaceRange("", from, to);
        paneEditors[cell.editorId].cmInstance.focus();
        app_1.dispatch("removeActiveCell", cell).commit();
        event.preventDefault();
    }
    else if (event.keyCode === utils_1.KEYS.ESC || (event.keyCode === utils_1.KEYS.ENTER && value.trim() === "")) {
        var _b = mark.find(), from = _b.from, to = _b.to;
        if (cell.placeholder) {
            cm.replaceRange("= ", from, to);
        }
        paneEditors[cell.editorId].cmInstance.focus();
        app_1.dispatch("removeActiveCell", cell).commit();
        event.preventDefault();
    }
    else if (event.keyCode === utils_1.KEYS.ENTER) {
        var doEmbed = makeDoEmbedFunction(cm, mark, cell, paneId);
        if (elem.selected && elem.selected.action) {
            if (typeof elem.selected.action === "function") {
                elem.selected.action(elem, value, doEmbed);
            }
        }
        event.preventDefault();
    }
    else if (event.keyCode === utils_1.KEYS.UP) {
        app_1.dispatch("moveCellAutocomplete", { cell: cell, direction: -1 }).commit();
        event.preventDefault();
    }
    else if (event.keyCode === utils_1.KEYS.DOWN) {
        app_1.dispatch("moveCellAutocomplete", { cell: cell, direction: 1 }).commit();
        event.preventDefault();
    }
    event.stopPropagation();
}
function updatePage(meta, content) {
    app_1.dispatch("update page", { page: meta.page, content: content }).commit();
}
//---------------------------------------------------------
// Editor prep
//---------------------------------------------------------
function prepareCardEditor(entityId, paneId) {
    var _a = (app_1.eve.findOne("entity", { entity: entityId }) || {}).content, content = _a === void 0 ? undefined : _a;
    var page = app_1.eve.findOne("entity page", { entity: entityId })["page"];
    var name = uitk.resolveName(entityId);
    var cells = getCells(content, paneId + "|" + entityId);
    var cellItems = cells.map(function (cell, ix) {
        var ui;
        var active = exports.activeCells[cell.id];
        if (active) {
            ui = cellEditor(entityId, paneId, active || cell);
        }
        else {
            ui = cellUI(paneId, cell.query, cell);
        }
        ui.id = paneId + "|" + cell.id;
        ui.postRender = reparentCell;
        ui["containerId"] = paneId + "|" + cell.id + "|container";
        ui["cell"] = cell;
        return ui;
    });
    var editorId = paneId + "|" + entityId;
    var keys = {
        "Backspace": function (cm) { return maybeActivateCell(cm, editorId); },
        "Cmd-Enter": function (cm) { return maybeNavigate(cm, editorId); },
        "=": function (cm) { return createEmbedPopout(cm, editorId); }
    };
    return { postRender: wikiEditor, onUpdate: updatePage, options: { keys: keys }, cells: cells, cellItems: cellItems };
}
//---------------------------------------------------------
// Page parsing
//---------------------------------------------------------
function getCells(content, editorId) {
    var cells = [];
    var ix = 0;
    var ids = {};
    for (var _i = 0, _a = content.split(/({[^]*?})/gm); _i < _a.length; _i++) {
        var part = _a[_i];
        if (part[0] === "{") {
            var id = part;
            if (!ids[part]) {
                ids[part] = 2;
            }
            else if (ids[part] >= 2) {
                id += ids[part];
                ids[part]++;
            }
            var placeholder = false;
            if (part.match(/\{\$\$.*\$\$\}/)) {
                placeholder = true;
            }
            cells.push({ start: ix, length: part.length, value: part, query: part.substring(1, part.length - 1), id: id, placeholder: placeholder, editorId: editorId });
        }
        ix += part.length;
    }
    for (var active in exports.activeCells) {
        var cell = exports.activeCells[active].cell;
        if (cell.placeholder && cell.editorId === editorId) {
            cells.push(cell);
        }
    }
    return cells;
}
//---------------------------------------------------------
// Attributes
//---------------------------------------------------------
app_1.handle("add entity attribute", function (changes, _a) {
    var entity = _a.entity, attribute = _a.attribute, value = _a.value;
    var success = handleAttributeDefinition(entity, attribute.trim(), value, changes);
});
app_1.handle("toggle add tile", function (changes, _a) {
    var key = _a.key, entityId = _a.entityId;
    var state = exports.uiState.widget.card[key] || { showAdd: false };
    state.showAdd = !state.showAdd;
    state.entityId = entityId;
    state.key = key;
    // in case you closed it with an adder selected
    if (state.showAdd) {
        state.adder = undefined;
    }
    exports.uiState.widget.card[key] = state;
});
app_1.handle("set tile adder", function (changes, _a) {
    var key = _a.key, adder = _a.adder;
    var state = exports.uiState.widget.card[key] || { showAdd: true, key: key };
    state.adder = adder;
    exports.uiState.widget.card[key] = state;
});
app_1.handle("set tile adder attribute", function (changes, _a) {
    var key = _a.key, attribute = _a.attribute, value = _a.value, isActiveTileAttribute = _a.isActiveTileAttribute;
    var state = exports.uiState.widget.card[key] || { showAdd: true, key: key };
    if (!isActiveTileAttribute) {
        state[attribute] = value.trim();
    }
    else {
        state.activeTile[attribute] = value.trim();
    }
    exports.uiState.widget.card[key] = state;
});
app_1.handle("submit tile adder", function (changes, _a) {
    var key = _a.key, node = _a.node;
    var state = exports.uiState.widget.card[key] || { showAdd: true, key: key };
    if (state.adder && state.adder.submit) {
        state.adder.submit(state.adder, state, node);
    }
    exports.uiState.widget.card[key] = state;
});
app_1.handle("activate tile", function (changes, _a) {
    var tileId = _a.tileId, cardId = _a.cardId;
    var state = exports.uiState.widget.card[cardId] || { showAdd: false, key: cardId };
    if (tileId && (!state.activeTile || state.activeTile.id !== tileId)) {
        state.activeTile = { id: tileId };
    }
    else if (!tileId) {
        state.activeTile = undefined;
    }
    exports.uiState.widget.card[cardId] = state;
});
function activateTile(event, elem) {
    if (event.defaultPrevented)
        return;
    app_1.dispatch("activate tile", { tileId: elem.tileId, cardId: elem.cardId }).commit();
}
function submitActiveTile(event, elem) {
    if (elem.source) {
        // replace
        app_1.dispatch("replace sourced tile", { key: elem.cardId, source: elem.source, attribute: elem.attribute, entityId: elem.entityId }).commit();
    }
    else {
        // handle a list submit
        app_1.dispatch("submit list tile", { cardId: elem.cardId, attribute: elem.attribute, entityId: elem.entityId, reverseEntityAndValue: elem.reverseEntityAndValue }).commit();
    }
    event.preventDefault();
}
function removeActiveTile(event, elem) {
    if (elem.source) {
        app_1.dispatch("remove sourced eav", { source: elem.source }).commit();
    }
    else {
        console.error("Tried to remove a tile without a source. What do we do?");
    }
    event.preventDefault();
}
function tile(elem) {
    var cardId = elem.cardId, tileId = elem.tileId, active = elem.active, attribute = elem.attribute, entityId = elem.entityId, source = elem.source, reverseEntityAndValue = elem.reverseEntityAndValue;
    var klass = (elem.c || "") + " tile";
    if (active) {
        klass += " active";
    }
    elem.c = klass;
    elem.children = [
        { c: "tile-content-wrapper", children: elem.children },
        { c: "edit ion-edit", click: activateTile, cardId: cardId, tileId: tileId, entityId: entityId, source: source },
        { c: "controls", children: [
                !elem.removeOnly ? { c: "ion-checkmark submit", click: submitActiveTile, cardId: cardId, attribute: attribute, entityId: entityId, source: source, reverseEntityAndValue: reverseEntityAndValue } : undefined,
                !elem.submitOnly ? { c: "ion-backspace cancel", click: removeActiveTile, cardId: cardId, attribute: attribute, entityId: entityId, source: source } : undefined,
            ] }
    ];
    return elem;
}
function isTileActive(cardId, tileId) {
    var state = exports.uiState.widget.card[cardId];
    return state && state.activeTile && state.activeTile.id === tileId;
}
app_1.handle("toggle active tile item", function (changes, _a) {
    var cardId = _a.cardId, attribute = _a.attribute, id = _a.id;
    var state = exports.uiState.widget.card[cardId] || { showAdd: true, key: cardId, activeTile: {} };
    if (!state.activeTile[attribute]) {
        state.activeTile[attribute] = {};
    }
    var cur = state.activeTile[attribute][id];
    if (cur) {
        delete state.activeTile[attribute][id];
    }
    else {
        state.activeTile[attribute][id] = true;
    }
    exports.uiState.widget.card[cardId] = state;
});
app_1.handle("submit list tile", function (changes, _a) {
    var cardId = _a.cardId, attribute = _a.attribute, entityId = _a.entityId, reverseEntityAndValue = _a.reverseEntityAndValue;
    var state = exports.uiState.widget.card[cardId] || { activeTile: {} };
    var _b = state.activeTile, itemsToRemove = _b.itemsToRemove, itemsToAdd = _b.itemsToAdd;
    if (itemsToRemove) {
        for (var source in itemsToRemove) {
            changes.remove("sourced eav", { source: source });
        }
    }
    if (itemsToAdd) {
        for (var _i = 0; _i < itemsToAdd.length; _i++) {
            var value = itemsToAdd[_i];
            if (value === "" || value === undefined)
                continue;
            if (!reverseEntityAndValue) {
                changes.dispatch("add sourced eav", { entity: entityId, attribute: attribute, value: value.trim(), forceEntity: true });
            }
            else {
                var cleaned = value.trim();
                var entityValue = asEntity(cleaned);
                if (!entityValue) {
                    //create an entity with that name
                    entityValue = utils_1.uuid();
                    var pageId = utils_1.uuid();
                    changes.dispatch("create page", { page: pageId, content: "" })
                        .dispatch("create entity", { entity: entityValue, name: cleaned, page: pageId });
                }
                changes.dispatch("add sourced eav", { entity: entityValue, attribute: attribute, value: entityId });
            }
        }
    }
    changes.dispatch("activate tile", { cardId: cardId });
});
function toggleListTileItem(event, elem) {
    app_1.dispatch("toggle active tile item", { cardId: elem.cardId, attribute: elem.storeAttribute, id: elem.storeId }).commit();
    event.preventDefault();
}
app_1.handle("add active tile item", function (changes, _a) {
    var cardId = _a.cardId, attribute = _a.attribute, id = _a.id, value = _a.value, tileId = _a.tileId;
    var state = exports.uiState.widget.card[cardId] || { showAdd: true, key: cardId, activeTile: { id: tileId } };
    if (!state.activeTile) {
        state.activeTile = { id: tileId };
    }
    if (!state.activeTile[attribute]) {
        state.activeTile[attribute] = [];
    }
    var cur = state.activeTile[attribute][id];
    state.activeTile[attribute][id] = value;
    exports.uiState.widget.card[cardId] = state;
});
function autosizeAndStoreListTileItem(event, elem) {
    var node = event.currentTarget;
    app_1.dispatch("add active tile item", { cardId: elem.cardId, attribute: elem.storeAttribute, tileId: elem.tileId, id: elem.storeId, value: node.value }).commit();
    uitk.autosizeInput(node, elem);
}
function listTile(elem) {
    var values = elem.values, data = elem.data, tileId = elem.tileId, attribute = elem.attribute, cardId = elem.cardId, entityId = elem.entityId, forceActive = elem.forceActive, reverseEntityAndValue = elem.reverseEntityAndValue, noProperty = elem.noProperty, _a = elem.rep, rep = _a === void 0 ? "value" : _a, _b = elem.c, klass = _b === void 0 ? "" : _b;
    tileId = tileId || attribute;
    var state = exports.uiState.widget.card[cardId] || {};
    var active = forceActive || isTileActive(cardId, tileId);
    var listChildren = [];
    var max = 0;
    for (var _i = 0; _i < values.length; _i++) {
        var value = values[_i];
        var current = reverseEntityAndValue ? value.eav.entity : value.eav.value;
        if (uitk.resolveName(current) === "entity" && attribute === "is a")
            continue;
        var source = value.source;
        var valueElem = { c: "value", data: data, text: current };
        if (rep === "externalImage") {
            valueElem.url = current;
            valueElem.text = undefined;
        }
        var ui = uitk[rep](valueElem);
        if (active) {
            ui["cardId"] = cardId;
            ui["storeAttribute"] = "itemsToRemove";
            ui["storeId"] = source;
            ui.click = toggleListTileItem;
            if (state.activeTile.itemsToRemove && state.activeTile.itemsToRemove[source]) {
                ui.c += " marked-to-remove";
            }
        }
        listChildren.push(ui);
    }
    if (active) {
        var added = (state.activeTile ? state.activeTile.itemsToAdd : false) || [];
        var ix = 0;
        for (var _c = 0; _c < added.length; _c++) {
            var add = added[_c];
            listChildren.push({ c: "value", children: [
                    { t: "input", placeholder: "add", value: add, attribute: attribute, entityId: entityId, storeAttribute: "itemsToAdd", storeId: ix, cardId: cardId, input: autosizeAndStoreListTileItem, postRender: uitk.autosizeAndFocus, keydown: handleTileKeys, reverseEntityAndValue: reverseEntityAndValue }
                ] });
            ix++;
        }
        listChildren.push({ c: "value", children: [
                { t: "input", placeholder: "add", value: "", attribute: attribute, entityId: entityId, storeAttribute: "itemsToAdd", storeId: ix, cardId: cardId, input: autosizeAndStoreListTileItem, postRender: ix === 0 ? uitk.autosizeAndFocus : uitk.autosizeInput, keydown: handleTileKeys, reverseEntityAndValue: reverseEntityAndValue }
            ] });
    }
    var tileChildren = [];
    var isIsA = attribute === "is a";
    if (!noProperty) {
        tileChildren.push({ c: "property", text: isIsA ? "tags" : attribute });
    }
    tileChildren.push({ c: "list", children: listChildren });
    var size = isIsA ? "is a" : "full";
    return tile({ c: klass + " " + size, size: size, cardId: cardId, data: data, tileId: tileId, active: active, attribute: attribute, entityId: entityId, reverseEntityAndValue: reverseEntityAndValue, submitOnly: true, children: tileChildren });
}
exports.listTile = listTile;
function autosizeTextarea(node, elem) {
    node.style.height = "1px";
    node.style.height = 1 + node.scrollHeight + "px";
}
function autosizeAndFocusTextArea(node, elem) {
    utils_1.autoFocus(node, elem);
    autosizeTextarea(node, elem);
}
function storeActiveTileValue(elem, value) {
    app_1.dispatch("set tile adder attribute", { key: elem.cardId, attribute: elem.storeAttribute, value: value, isActiveTileAttribute: true }).commit();
}
app_1.handle("replace sourced tile", function (changes, _a) {
    var key = _a.key, attribute = _a.attribute, entityId = _a.entityId, source = _a.source;
    var state = exports.uiState.widget.card[key] || { activeTile: {} };
    var replaceValue = state.activeTile.replaceValue;
    var sourced = app_1.eve.findOne("sourced eav", { source: source });
    if (!sourced) {
        console.error("Tried to modify a sourced eav that doesn't exist?");
        return;
    }
    if (replaceValue !== undefined && sourced.value !== replaceValue.trim()) {
        changes.remove("sourced eav", { source: source });
        if (attribute === "description") {
            replaceValue = "\"" + replaceValue + "\"";
        }
        changes.dispatch("add sourced eav", { entity: entityId, attribute: attribute, value: replaceValue, forceEntity: true });
    }
    changes.dispatch("activate tile", { cardId: key });
});
function handleTileKeys(event, elem) {
    if (event.keyCode === utils_1.KEYS.ENTER) {
        if (elem.source) {
            app_1.dispatch("replace sourced tile", { key: elem.cardId, source: elem.source, attribute: elem.attribute, entityId: elem.entityId }).commit();
        }
        else {
            app_1.dispatch("submit list tile", { cardId: elem.cardId, attribute: elem.attribute, entityId: elem.entityId, reverseEntityAndValue: elem.reverseEntityAndValue }).commit();
        }
        event.preventDefault();
    }
    else if (event.keyCode === utils_1.KEYS.ESC) {
        app_1.dispatch("activate tile", { cardId: elem.cardId }).commit();
    }
}
function autosizeAndStoreTextarea(event, elem) {
    var node = event.currentTarget;
    storeActiveTileValue(elem, node.value);
    autosizeTextarea(node, elem);
}
function textTile(elem) {
    var value = elem.value, data = elem.data, attribute = elem.attribute, cardId = elem.cardId, entityId = elem.entityId;
    var tileId = value.source;
    var source = value.source;
    var state = exports.uiState.widget.card[cardId] || {};
    var active = isTileActive(cardId, tileId);
    var tileChildren = [];
    if (attribute !== "description") {
        tileChildren.push({ c: "property", text: attribute });
    }
    if (!active) {
        tileChildren.push({ c: "value text", text: value.eav.value });
    }
    else {
        tileChildren.push({ t: "textarea", c: "value text", source: source, attribute: attribute, storeAttribute: "replaceValue", cardId: cardId, entityId: entityId,
            keydown: handleTileKeys, input: autosizeAndStoreTextarea, postRender: autosizeAndFocusTextArea, value: value.eav.value });
    }
    return tile({ c: "full", tileId: tileId, cardId: cardId, entityId: entityId, attribute: attribute, source: source, active: active, children: tileChildren });
}
function autosizeAndStoreInput(event, elem) {
    var node = event.currentTarget;
    storeActiveTileValue(elem, node.value);
    uitk.autosizeInput(node, elem);
}
function valueTile(elem) {
    var value = elem.value, data = elem.data, attribute = elem.attribute, cardId = elem.cardId, entityId = elem.entityId;
    var tileId = attribute;
    var source = value.source;
    var state = exports.uiState.widget.card[cardId] || {};
    var active = isTileActive(cardId, tileId);
    var tileChildren = [];
    tileChildren.push({ c: "property", text: attribute });
    var ui;
    var content = uitk.resolveName(value.eav.value);
    if (!content)
        content = value.eav.value;
    if (!active) {
        ui = uitk.value({ c: "value", data: data, text: value.eav.value });
    }
    else {
        ui = { t: "input", c: "value", source: source, attribute: attribute, storeAttribute: "replaceValue", cardId: cardId, entityId: entityId, value: content, postRender: uitk.autosizeAndFocus,
            input: autosizeAndStoreInput, keydown: handleTileKeys };
    }
    var max = Math.max(content.toString().length, 0);
    tileChildren.push({ c: "value", children: [ui] });
    var size;
    if (max <= 8) {
        size = "small";
    }
    else if (max <= 16) {
        size = "medium";
    }
    else {
        size = "full";
    }
    var klass = size;
    if (!value.isManual) {
        klass += " computed";
    }
    return tile({ c: klass, size: size, cardId: cardId, data: data, tileId: tileId, active: active, attribute: attribute, source: source, entityId: entityId, children: tileChildren });
}
function imageTile(elem) {
    var values = elem.values, data = elem.data, attribute = elem.attribute, cardId = elem.cardId, entityId = elem.entityId;
    var ui;
    if (values.length > 1) {
        elem.rep = "externalImage";
        elem.noProperty = true;
        elem.c = "image ";
        ui = listTile(elem);
    }
    else {
        var value = values[0];
        var source = value.source;
        var size = "full";
        var klass = "image full";
        var tileId = attribute;
        var tileChildren = [{ t: "img", c: "image", src: "" + value.eav.value }];
        var active = isTileActive(cardId, tileId);
        ui = tile({ c: klass, size: size, cardId: cardId, data: data, tileId: tileId, active: active, attribute: attribute, source: source, entityId: entityId, children: tileChildren });
    }
    return ui;
}
function documentTile(elem) {
    var value = elem.value, data = elem.data, attribute = elem.attribute, cardId = elem.cardId, entityId = elem.entityId;
    var tileChildren = [];
    var tileId = attribute;
    var source = value.source;
    var state = exports.uiState.widget.card[cardId] || {};
    var active = isTileActive(cardId, tileId);
    var size = "full";
    var klass = "document full";
    return tile({ c: klass, size: size, cardId: cardId, data: data, tileId: tileId, active: active, attribute: attribute, source: source, entityId: entityId, children: tileChildren });
}
function row(elem) {
    elem.c = (elem.c || "") + " row flex-row";
    return elem;
}
function getEAVInfo(eav) {
    var entity = eav.entity, attribute = eav.attribute, value = eav.value;
    var found = app_1.eve.findOne("generated eav", { entity: entity, attribute: attribute, value: value });
    var sourceId = app_1.eve.findOne("sourced eav", { entity: entity, attribute: attribute, value: value });
    var item = { eav: eav, isManual: !found };
    if (found) {
        item.sourceView = found.source;
        item.source = found.source;
    }
    else if (sourceId) {
        item.source = sourceId.source;
    }
    return item;
}
function entityTilesUI(entityId, paneId, cardId) {
    var eavs = app_1.eve.find("entity eavs", { entity: entityId });
    var items = {};
    var attrs = [];
    for (var _i = 0; _i < eavs.length; _i++) {
        var eav = eavs[_i];
        var attribute = eav.attribute;
        var info = getEAVInfo(eav);
        if (!items[attribute]) {
            items[attribute] = [];
            attrs.push(attribute);
        }
        items[attribute].push(info);
    }
    var tiles = { "small": [], "medium": [], "full": [], "is a": [] };
    var rows = [];
    var data = { paneId: paneId, entityId: entityId };
    if (items["image"]) {
        var values = items["image"];
        var tile_1 = imageTile({ values: values, data: data, cardId: cardId, entityId: entityId, attribute: "image" });
        rows.push(row({ children: [tile_1] }));
        delete items["image"];
    }
    if (items["description"]) {
        var values = items["description"];
        for (var _a = 0; _a < values.length; _a++) {
            var value = values[_a];
            var tile_2 = textTile({ value: value, data: data, cardId: cardId, entityId: entityId, attribute: "description" });
            rows.push(row({ children: [tile_2] }));
        }
        delete items["description"];
    }
    if (app_1.eve.findOne("collection", { collection: entityId }) || app_1.eve.findOne("entity eavs", { entity: entityId, attribute: "is a", value: asEntity("collection") })) {
        var listChildren = [];
        var entities = app_1.eve.find("entity eavs", { attribute: "is a", value: entityId });
        var values = entities.map(getEAVInfo);
        var tile_3 = listTile({ values: values, data: data, cardId: cardId, entityId: entityId, attribute: "is a", reverseEntityAndValue: true, tileId: "_collectionItems", noProperty: true });
        rows.push(row({ children: [tile_3] }));
    }
    var tilesToPlace = 0;
    for (var _b = 0; _b < attrs.length; _b++) {
        var attribute = attrs[_b];
        var values = items[attribute];
        if (!values)
            continue;
        var newTile = void 0;
        if (values.length > 1 || attribute === "is a") {
            newTile = listTile({ values: values, data: data, attribute: attribute, cardId: cardId, entityId: entityId });
        }
        else {
            newTile = valueTile({ value: values[0], data: data, attribute: attribute, cardId: cardId, entityId: entityId });
        }
        var size = newTile.size;
        tiles[size].push(newTile);
        if (size !== "is a")
            tilesToPlace++;
    }
    var optionIx = 0;
    while (tilesToPlace > 0) {
        var rowChildren = [];
        var iter = 0;
        while (iter < 5 && !rowChildren.length) {
            if (optionIx === 0 && tiles["full"].length) {
                rowChildren.push(tiles["full"].pop());
                break;
            }
            if (optionIx === 1 && tiles["medium"].length > 1) {
                rowChildren.push(tiles["medium"].pop());
                rowChildren.push(tiles["medium"].pop());
                break;
            }
            if (optionIx === 2 && tiles["medium"].length && tiles["small"].length >= 1) {
                rowChildren.push(tiles["medium"].pop());
                rowChildren.push(tiles["small"].pop());
                break;
            }
            if (optionIx === 3 && tiles["small"].length >= 3) {
                rowChildren.push(tiles["small"].pop());
                rowChildren.push(tiles["small"].pop());
                rowChildren.push(tiles["small"].pop());
                break;
            }
            if (optionIx === 4 && tiles["medium"].length) {
                rowChildren.push(tiles["medium"].pop());
                break;
            }
            if (optionIx > 4)
                optionIx = 0;
            else
                optionIx++;
            iter++;
        }
        // any smalls leftover
        if (!rowChildren.length) {
            while (tiles["small"].length) {
                rowChildren.push(tiles["small"].pop());
            }
        }
        tilesToPlace -= rowChildren.length;
        rows.push({ c: "flex-row row", children: rowChildren });
    }
    if (tiles["is a"]) {
        rows.push({ c: "flex-row row", children: [tiles["is a"][0]] });
    }
    var state = exports.uiState.widget.attributes[entityId] || {};
    return { c: "tiles", children: rows };
}
exports.entityTilesUI = entityTilesUI;
function attributesUIAutocompleteOptions(isEntity, parsed, text, params, entityId) {
    var options = [];
    //there are two possible things either we're creating a page
    // or we need to pick what field of the result we want
    return options;
}
app_1.handle("setActiveAttribute", function (changes, _a) {
    var eav = _a.eav, sourceView = _a.sourceView;
    if (!exports.uiState.widget.attributes[eav.entity]) {
        exports.uiState.widget.attributes[eav.entity] = {};
    }
    var cur = exports.uiState.widget.attributes[eav.entity];
    cur.active = eav;
    cur.sourceView = sourceView;
});
app_1.handle("clearActiveAttribute", function (changes, _a) {
    var entity = _a.entity;
    var cur = exports.uiState.widget.attributes[entity];
    if (cur) {
        cur.active = false;
        cur.sourceView = false;
    }
});
function removeSubItem(event, elem) {
    event.preventDefault();
    submitAttribute(event, elem);
}
function setActiveAttribute(event, elem) {
    if (!event.defaultPrevented) {
        app_1.dispatch("setActiveAttribute", { eav: elem.eav, sourceView: elem.sourceView }).commit();
        event.preventDefault();
    }
}
function handleAttributesKey(event, elem) {
    if (event.keyCode === utils_1.KEYS.ENTER && elem.submit) {
        elem.submit(event, elem);
    }
    else if (event.keyCode === utils_1.KEYS.ESC) {
        app_1.dispatch("setActiveAttribute", { eav: { entity: elem.eav.entity }, sourceView: false }).commit();
    }
}
app_1.handle("setAttributeAdder", function (changes, _a) {
    var entityId = _a.entityId, field = _a.field, value = _a.value;
    var cur = exports.uiState.widget.attributes[entityId];
    if (!exports.uiState.widget.attributes[entityId]) {
        cur = exports.uiState.widget.attributes[entityId] = {};
    }
    cur[field] = value;
});
function setAdder(event, elem) {
    var value = event.currentTarget.value;
    app_1.dispatch("setAttributeAdder", { entityId: elem.entityId, field: elem.field, value: value }).commit();
}
function submitAdder(event, elem) {
    var entityId = elem.entityId;
    var state = exports.uiState.widget.attributes[entityId];
    if (!state)
        return;
    var adderAttribute = state.adderAttribute, adderValue = state.adderValue;
    var success = false;
    if (adderAttribute && adderValue) {
        var chain = app_1.dispatch("setAttributeAdder", { entityId: entityId, field: "adderAttribute", value: "" })
            .dispatch("setAttributeAdder", { entityId: entityId, field: "adderValue", value: "" });
        success = handleAttributeDefinition(entityId, adderAttribute, adderValue, chain);
    }
    //make sure the focus ends up back in the property input
    event.currentTarget.parentNode.firstChild.focus();
    return success;
}
app_1.handle("remove attribute generating query", function (changes, _a) {
    var eav = _a.eav, view = _a.view;
    var queryId = eav.entity + "|" + eav.attribute + "|" + view;
    app_1.eve.removeView(queryId);
    changes.merge(runtime_1.Query.remove(queryId, app_1.eve));
    //find all the unions this was used with
    for (var _i = 0, _b = app_1.eve.find("action source", { "source view": queryId }); _i < _b.length; _i++) {
        var source = _b[_i];
        var action = source.action;
        changes.remove("action", { action: action });
        changes.remove("action mapping", { action: action });
        changes.remove("action mapping constant", { action: action });
    }
    changes.remove("action source", { source: queryId });
});
function submitAttribute(event, elem) {
    var eav = elem.eav, sourceView = elem.sourceView, query = elem.query;
    var chain = app_1.dispatch("clearActiveAttribute", { entity: eav.entity });
    var value = event.currentTarget.value;
    if (query !== undefined && value === query) {
        return chain.commit();
    }
    if (elem.sourceView !== undefined) {
        //remove the previous source
        chain.dispatch("remove attribute generating query", { eav: eav, view: sourceView });
    }
    else {
        //remove the previous eav
        var fact = utils_1.copy(eav);
        fact.__id = undefined;
        chain.dispatch("remove entity attribute", fact);
    }
    if (value !== undefined && value !== "") {
        return handleAttributeDefinition(eav.entity, eav.attribute, value, chain);
    }
    else {
        chain.commit();
    }
}
//---------------------------------------------------------
// Wiki Widgets
//---------------------------------------------------------
function searchInput(paneId, value) {
    var state = exports.uiState.widget.search[paneId] || { focused: false, plan: false };
    var name = state.value;
    if (!state.value)
        state.value = name;
    var display = app_1.eve.findOne("display name", { id: name });
    if (display)
        name = display.name;
    return {
        c: "flex-grow wiki-search-wrapper",
        children: [
            { c: "controls", children: [
                    // {c: `ion-ios-arrow-${state.plan ? 'up' : 'down'} plan`, click: toggleSearchPlan, paneId},
                    // while technically a button, we don't need to do anything as clicking it will blur the editor
                    // which will execute the search
                    { c: "ion-android-search visible", paneId: paneId }
                ] },
            codeMirrorElement({
                c: "flex-grow wiki-search-input " + (state.focused ? "selected" : ""),
                paneId: paneId,
                autoFocus: true,
                value: name,
                focus: focusSearch,
                blur: setSearch,
                cursorPosition: "end",
                change: updateSearch,
                shortcuts: { "Enter": setSearch }
            }),
        ]
    };
}
exports.searchInput = searchInput;
;
function focusSearch(event, elem) {
    app_1.dispatch("ui focus search", elem).commit();
}
function setSearch(event, elem) {
    var state = exports.uiState.widget.search[elem.paneId] || { value: "" };
    var value = event.value !== undefined ? event.value : state.value;
    var pane = app_1.eve.findOne("ui pane", { pane: elem.paneId });
    if (!pane || pane.contains !== event.value) {
        var _a = dispatchSearchSetAttributes(value), chain = _a.chain, isSetSearch = _a.isSetSearch;
        if (isSetSearch) {
            chain.dispatch("ui update search", { paneId: elem.paneId, value: pane.contains });
            chain.commit();
        }
        else {
            chain.dispatch("insert query", { query: value })
                .dispatch("set pane", { paneId: elem.paneId, contains: value })
                .commit();
        }
    }
}
function updateSearch(event, elem) {
    app_1.dispatch("ui update search", { paneId: elem.paneId, value: event.value }).commit();
}
function toggleSearchPlan(event, elem) {
    app_1.dispatch("ui toggle search plan", elem).commit();
}
;
function codeMirrorElement(elem) {
    elem.postRender = codeMirrorPostRender(elem.postRender);
    elem["cmChange"] = elem.change;
    elem["cmBlur"] = elem.blur;
    elem["cmFocus"] = elem.focus;
    elem.change = undefined;
    elem.blur = undefined;
    elem.focus = undefined;
    return elem;
}
exports.codeMirrorElement = codeMirrorElement;
var _codeMirrorPostRenderMemo = {};
function handleCMEvent(handler, elem) {
    return function (cm) {
        var evt = (new CustomEvent("CMEvent"));
        evt.editor = cm;
        evt.value = cm.getDoc().getValue();
        handler(evt, elem);
    };
}
function codeMirrorPostRender(postRender) {
    var key = postRender ? postRender.toString() : "";
    if (_codeMirrorPostRenderMemo[key])
        return _codeMirrorPostRenderMemo[key];
    return _codeMirrorPostRenderMemo[key] = function (node, elem) {
        var cm = node.cm;
        if (!cm) {
            var extraKeys = {};
            if (elem.shortcuts) {
                for (var shortcut in elem.shortcuts)
                    extraKeys[shortcut] = handleCMEvent(elem.shortcuts[shortcut], elem);
            }
            cm = node.cm = CodeMirror(node, {
                lineWrapping: elem.lineWrapping !== false ? true : false,
                lineNumbers: elem.lineNumbers,
                mode: elem.mode || "text",
                extraKeys: extraKeys
            });
            if (elem["cmChange"])
                cm.on("change", handleCMEvent(elem["cmChange"], elem));
            if (elem["cmBlur"])
                cm.on("blur", handleCMEvent(elem["cmBlur"], elem));
            if (elem["cmFocus"])
                cm.on("focus", handleCMEvent(elem["cmFocus"], elem));
            if (elem.autoFocus)
                cm.focus();
        }
        if (cm.getDoc().getValue() !== elem.value) {
            cm.setValue(elem.value || "");
            if (elem["cursorPosition"] === "end") {
                cm.setCursor(100000);
            }
        }
        if (postRender)
            postRender(node, elem);
    };
}
function getEntitiesFromResults(results, _a) {
    var _b = (_a === void 0 ? {} : _a).fields, fields = _b === void 0 ? ["entity"] : _b;
    var entities = [];
    if (!results.length)
        return entities;
    for (var _i = 0; _i < fields.length; _i++) {
        var field = fields[_i];
        if (results[0][field] === undefined)
            field = utils_1.builtinId(field);
        for (var _c = 0; _c < results.length; _c++) {
            var fact = results[_c];
            entities.push(fact[field]);
        }
    }
    return entities;
}
function getURLsFromResults(results, _a) {
    var _b = (_a === void 0 ? {} : _a).fields, fields = _b === void 0 ? ["url"] : _b;
    var urls = [];
    if (!results.length)
        return urls;
    for (var _i = 0; _i < fields.length; _i++) {
        var field = fields[_i];
        if (results[0][field] === undefined)
            field = utils_1.builtinId(field);
        for (var _c = 0; _c < results.length; _c++) {
            var fact = results[_c];
            if (urlRegex.exec(fact[field]))
                urls.push(fact[field]);
        }
    }
    return urls;
}
function prepareEntity(results, params) {
    var elem = {};
    var entities = getEntitiesFromResults(results, { fields: params.field ? [params.field] : undefined });
    var elems = [];
    for (var _i = 0; _i < entities.length; _i++) {
        var entity = entities[_i];
        var elem_1 = utils_1.copy(params);
        elem_1.entity = entity;
        elems.push(elem_1);
    }
    if (elems.length === 1)
        return elems[0];
    else
        return elems;
}
function prepareURL(results, params) {
    var elem = {};
    var urls = getURLsFromResults(results, { fields: params.field ? [params.field] : undefined });
    var elems = [];
    for (var _i = 0; _i < urls.length; _i++) {
        var url = urls[_i];
        var elem_2 = utils_1.copy(params);
        elem_2.url = url;
        elems.push(elem_2);
    }
    if (elems.length === 1)
        return elems[0];
    else
        return elems;
}
var _prepare = {
    name: prepareEntity,
    link: prepareEntity,
    attributes: prepareEntity,
    related: prepareEntity,
    index: prepareEntity,
    view: prepareEntity,
    results: prepareEntity,
    value: function (results, params) {
        if (!params.field)
            throw new Error("Value representation requires a 'field' param indicating which field to represent");
        var field = params.field;
        if (!results.length)
            return [];
        // If field isn't in results, try to resolve it as a field name, otherwise error out
        if (results[0][field] === undefined) {
            var neueField = asEntity(field);
            if (!neueField)
                throw new Error("Unable to uniquely resolve field name " + field + " in result fields " + Object.keys(results[0]));
            else
                field = neueField;
        }
        var elems = [];
        for (var _i = 0; _i < results.length; _i++) {
            var row_1 = results[_i];
            elems.push({ text: row_1[field], data: params.data });
        }
        return elems;
    },
    CSV: function (results, params) {
        if (!params.field)
            throw new Error("Value representation requires a 'field' param indicating which field to represent");
        var field = params.field;
        if (!results.length)
            return [];
        // If field isn't in results, try to resolve it as a field name, otherwise error out
        if (results[0][field] === undefined) {
            var neueField = asEntity(field);
            if (!neueField)
                throw new Error("Unable to uniquely resolve field name " + field + " in result fields " + Object.keys(results[0]));
            else
                field = neueField;
        }
        var values = [];
        for (var _i = 0; _i < results.length; _i++) {
            var row_2 = results[_i];
            values.push(row_2[field]);
        }
        return { values: values, data: params.data };
    },
    entity: function (results, params) {
        var entities = [];
        var firstResult = results[0];
        var fields = Object.keys(firstResult).filter(function (field) {
            return !!asEntity(firstResult[field]);
        });
        for (var _i = 0; _i < results.length; _i++) {
            var result = results[_i];
            for (var _a = 0; _a < fields.length; _a++) {
                var field = fields[_a];
                var entityId = result[field];
                var paneId = params["paneId"];
                var editor = prepareCardEditor(entityId, paneId);
                entities.push({ entity: result[field], data: params, editor: editor });
            }
        }
        return entities;
    },
    error: function (results, params) {
        return { text: params["message"] };
    },
    mappedTable: function (results, params) {
        var paneId = params.paneId || params.data && params.data.paneId;
        var key = paneId + "|" + params.search;
        var state = exports.uiState.widget.table[key];
        if (!state) {
            state = exports.uiState.widget.table[key] = { sortField: undefined, sortDirection: 1, adder: {} };
        }
        params["sortable"] = true;
        params["rows"] = results;
        params["state"] = state;
        return params;
    },
    table: function (results, params) {
        var paneId = params.paneId || params.data && params.data.paneId;
        var key = paneId + "|" + params.search;
        var state = exports.uiState.widget.table[key];
        if (!state) {
            state = exports.uiState.widget.table[key] = { sortField: undefined, sortDirection: 1, adder: {} };
        }
        params["rows"] = results;
        params["state"] = state;
        return params;
        //return {rows: results, fields, state, groups: groupings, sortable: true, data: params.data};
    },
    directory: function (results, params) {
        var entities = getEntitiesFromResults(results, { fields: params.field ? [params.field] : undefined });
        if (entities.length === 1) {
            var collection = entities[0];
            entities.length = 0;
            for (var _i = 0, _a = app_1.eve.find("is a attributes", { collection: collection }); _i < _a.length; _i++) {
                var fact = _a[_i];
                entities.push(fact.entity);
            }
        }
        return { entities: entities, data: params.data };
    },
    externalLink: prepareURL,
    externalImage: prepareURL,
    externalVideo: prepareURL,
    embeddedCell: function (results, params) {
        var rep = params["childRep"];
        var childInfo;
        if (_prepare[rep]) {
            params["data"] = params["data"] || params;
            childInfo = _prepare[rep](results, params);
            childInfo.data = childInfo.data || params;
        }
        else {
            childInfo = { data: params };
        }
        return { childInfo: childInfo, rep: rep, click: activateCell, cell: params["cell"] };
    },
};
function represent(search, rep, results, params, wrapEach) {
    if (rep in _prepare) {
        var embedParamSets = _prepare[rep](results && results.results, params);
        var isArray = embedParamSets && embedParamSets.constructor === Array;
        // try {
        if (!embedParamSets || isArray && embedParamSets.length === 0) {
            return uitk.error({ text: search + " as " + rep });
        }
        else if (embedParamSets.constructor === Array) {
            var wrapper = { c: "flex-column", children: [] };
            var ix = 0;
            for (var _i = 0; _i < embedParamSets.length; _i++) {
                var embedParams = embedParamSets[_i];
                embedParams["data"] = embedParams["data"] || params;
                if (wrapEach)
                    wrapper.children.push(wrapEach(uitk[rep](embedParams), ix++));
                else
                    wrapper.children.push(uitk[rep](embedParams));
            }
            return wrapper;
        }
        else {
            var embedParams = embedParamSets;
            embedParams["data"] = embedParams["data"] || params;
            if (wrapEach)
                return { c: "flex-column", children: [wrapEach(uitk[rep](embedParams))] };
            else
                return { c: "flex-column", children: [uitk[rep](embedParams)] };
        }
    }
    else {
        console.error("REPRESENTATION ERROR");
        console.error({ search: search, rep: rep, results: results, params: params });
        return uitk.error({ text: "Unknown representation " + (params["childRep"] || rep) });
    }
}
var historyState = window.history.state;
var historyURL = utils_1.location();
window.addEventListener("popstate", function (evt) {
    var popout = app_1.eve.findOne("ui pane", { kind: PANE.POPOUT });
    if (popout && popoutHistory.length) {
        window.history.pushState(historyState, null, historyURL);
        var _a = popoutHistory.pop(), rep = _a.rep, contains_1 = _a.contains, params = _a.params, x = _a.x, y = _a.y;
        app_1.dispatch("set popout", { parentId: "p1", rep: rep, contains: contains_1, params: params, x: x, y: y, popState: true }).commit(); // @TODO: make "p1" a constant
        return;
    }
    else if (evt.state && evt.state.root) {
        window.history.back();
        return;
    }
    historyState = evt.state;
    historyURL = utils_1.location();
    var _b = evt.state || {}, _c = _b.paneId, paneId = _c === void 0 ? undefined : _c, _d = _b.contains, contains = _d === void 0 ? undefined : _d;
    if (paneId === undefined || contains === undefined)
        return;
    app_1.dispatch("set pane", { paneId: paneId, contains: contains, popState: true }).commit();
});
// Prevent backspace from going back
window.addEventListener("keydown", function (event) {
    var current = event.target;
    if (event.keyCode === utils_1.KEYS.BACKSPACE && current.nodeName !== "INPUT" && current.nodeName !== "TEXTAREA" && current.contentEditable !== "true") {
        event.preventDefault();
    }
});
// @NOTE: Uncomment this to enable the new UI, or type `window["NEUE_UI"] = true; app.render()` into the console to enable it transiently.
window["NEUE_UI"] = true;
var _a;

},{"./NLQueryParser":8,"./app":9,"./parser":13,"./richTextEditor":14,"./runtime":15,"./uitk":18,"./utils":19,"codemirror":2}],17:[function(require,module,exports){
var utils_1 = require("./utils");
var runtime_1 = require("./runtime");
function resolve(table, fact) {
    var neue = {};
    for (var field in fact)
        neue[(table + ": " + field)] = fact[field];
    return neue;
}
function humanize(table, fact) {
    var neue = {};
    for (var field in fact)
        neue[field.slice(table.length + 2)] = fact[field];
    return neue;
}
function resolvedAdd(changeset, table, fact) {
    return changeset.add(table, resolve(table, fact));
}
function resolvedRemove(changeset, table, fact) {
    return changeset.remove(table, resolve(table, fact));
}
function humanizedFind(ixer, table, query) {
    var results = [];
    for (var _i = 0, _a = ixer.find(table, resolve(table, query)); _i < _a.length; _i++) {
        var fact = _a[_i];
        results.push(humanize(table, fact));
    }
    var diag = {};
    for (var table_1 in ixer.tables)
        diag[table_1] = ixer.tables[table_1].table.length;
    return results;
}
var UI = (function () {
    function UI(id) {
        this.id = id;
        this._children = [];
        this._attributes = {};
        this._events = {};
    }
    UI.remove = function (template, ixer) {
        var changeset = ixer.diff();
        resolvedRemove(changeset, "ui template", { template: template });
        resolvedRemove(changeset, "ui template binding", { template: template });
        var bindings = humanizedFind(ixer, "ui template binding", { template: template });
        for (var _i = 0; _i < bindings.length; _i++) {
            var binding = bindings[_i];
            changeset.merge(runtime_1.Query.remove(binding.binding, ixer));
        }
        resolvedRemove(changeset, "ui embed", { template: template });
        var embeds = humanizedFind(ixer, "ui embed", { template: template });
        for (var _a = 0; _a < embeds.length; _a++) {
            var embed = embeds[_a];
            resolvedRemove(changeset, "ui embed scope", { template: template, embed: embed.embed });
            resolvedRemove(changeset, "ui embed scope binding", { template: template, embed: embed.embed });
        }
        resolvedRemove(changeset, "ui attribute", { template: template });
        resolvedRemove(changeset, "ui attribute binding", { template: template });
        resolvedRemove(changeset, "ui event", { template: template });
        var events = humanizedFind(ixer, "ui event", { template: template });
        for (var _b = 0; _b < events.length; _b++) {
            var event_1 = events[_b];
            resolvedRemove(changeset, "ui event state", { template: template, event: event_1.event });
            resolvedRemove(changeset, "ui event state binding", { template: template, event: event_1.event });
        }
        for (var _c = 0, _d = humanizedFind(ixer, "ui template", { parent: template }); _c < _d.length; _c++) {
            var child = _d[_c];
            changeset.merge(UI.remove(child.template, ixer));
        }
        return changeset;
    };
    UI.prototype.copy = function () {
        var neue = new UI(this.id);
        neue._binding = this._binding;
        neue._embedded = this._embedded;
        neue._children = this._children;
        neue._attributes = this._attributes;
        neue._events = this._events;
        neue._parent = this._parent;
        return neue;
    };
    UI.prototype.changeset = function (ixer) {
        var changeset = ixer.diff();
        var parent = this._attributes["parent"] || (this._parent && this._parent.id) || "";
        var ix = this._attributes["ix"];
        if (ix === undefined)
            ix = (this._parent && this._parent._children.indexOf(this));
        if (ix === -1 || ix === undefined)
            ix = "";
        if (this._embedded)
            parent = "";
        resolvedAdd(changeset, "ui template", { template: this.id, parent: parent, ix: ix });
        if (this._binding) {
            if (!this._binding.name || this._binding.name === "unknown")
                this._binding.name = "bound view " + this.id;
            changeset.merge(this._binding.changeset(ixer));
            resolvedAdd(changeset, "ui template binding", { template: this.id, binding: this._binding.name });
        }
        if (this._embedded) {
            var embed = utils_1.uuid();
            resolvedAdd(changeset, "ui embed", { embed: embed, template: this.id, parent: (this._parent || {}).id, ix: ix });
            for (var key in this._embedded) {
                var value = this._attributes[key];
                if (value instanceof Array)
                    resolvedAdd(changeset, "ui embed scope binding", { embed: embed, key: key, source: value[0], alias: value[1] });
                else
                    resolvedAdd(changeset, "ui embed scope", { embed: embed, key: key, value: value });
            }
        }
        for (var property in this._attributes) {
            var value = this._attributes[property];
            if (value instanceof Array)
                resolvedAdd(changeset, "ui attribute binding", { template: this.id, property: property, source: value[0], alias: value[1] });
            else
                resolvedAdd(changeset, "ui attribute", { template: this.id, property: property, value: value });
        }
        for (var event_2 in this._events) {
            resolvedAdd(changeset, "ui event", { template: this.id, event: event_2 });
            var state = this._events[event_2];
            for (var key in state) {
                var value = state[key];
                if (value instanceof Array)
                    resolvedAdd(changeset, "ui event state binding", { template: this.id, event: event_2, key: key, source: value[0], alias: value[1] });
                else
                    resolvedAdd(changeset, "ui event state", { template: this.id, event: event_2, key: key, value: value });
            }
        }
        for (var _i = 0, _a = this._children; _i < _a.length; _i++) {
            var child = _a[_i];
            changeset.merge(child.changeset(ixer));
        }
        return changeset;
    };
    UI.prototype.load = function (template, ixer, parent) {
        var fact = humanizedFind(ixer, "ui template", { template: template })[0];
        if (!fact)
            return this;
        if (parent || fact.parent)
            this._parent = parent || new UI(this._parent);
        var binding = humanizedFind(ixer, "ui template binding", { template: template })[0];
        if (binding)
            this.bind((new runtime_1.Query(ixer, binding.binding)));
        var embed = humanizedFind(ixer, "ui embed", { template: template, parent: this._parent ? this._parent.id : "" })[0];
        if (embed) {
            var scope = {};
            for (var _i = 0, _a = humanizedFind(ixer, "ui embed scope", { embed: embed.embed }); _i < _a.length; _i++) {
                var attr = _a[_i];
                scope[attr.key] = attr.value;
            }
            for (var _b = 0, _c = humanizedFind(ixer, "ui embed scope binding", { embed: embed.embed }); _b < _c.length; _b++) {
                var attr = _c[_b];
                scope[attr.key] = [attr.source, attr.alias];
            }
            this.embed(scope);
        }
        for (var _d = 0, _e = humanizedFind(ixer, "ui attribute", { template: template }); _d < _e.length; _d++) {
            var attr = _e[_d];
            this.attribute(attr.property, attr.value);
        }
        for (var _f = 0, _g = humanizedFind(ixer, "ui attribute binding", { template: template }); _f < _g.length; _f++) {
            var attr = _g[_f];
            this.attribute(attr.property, [attr.source, attr.alias]);
        }
        for (var _h = 0, _j = humanizedFind(ixer, "ui event", { template: template }); _h < _j.length; _h++) {
            var event_3 = _j[_h];
            var state = {};
            for (var _k = 0, _l = humanizedFind(ixer, "ui event state", { template: template, event: event_3.event }); _k < _l.length; _k++) {
                var attr = _l[_k];
                state[event_3.key] = event_3.value;
            }
            for (var _m = 0, _o = humanizedFind(ixer, "ui event state binding", { template: template, event: event_3.event }); _m < _o.length; _m++) {
                var attr = _o[_m];
                state[event_3.key] = [event_3.source, event_3.alias];
            }
            this.event(event_3.event, state);
        }
        for (var _p = 0, _q = humanizedFind(ixer, "ui template", { parent: template }); _p < _q.length; _p++) {
            var child = _q[_p];
            this.child((new UI(child.template)).load(child.template, ixer, this));
        }
        return this;
    };
    UI.prototype.children = function (neue, append) {
        if (append === void 0) { append = false; }
        if (!neue)
            return this._children;
        if (!append)
            this._children.length = 0;
        for (var _i = 0; _i < neue.length; _i++) {
            var child = neue[_i];
            var copied = child.copy();
            copied._parent = this;
            this._children.push(copied);
        }
        return this._children;
    };
    UI.prototype.child = function (child, ix, embed) {
        child = child.copy();
        child._parent = this;
        if (embed)
            child.embed(embed);
        if (!ix)
            this._children.push(child);
        else
            this._children.splice(ix, 0, child);
        return child;
    };
    UI.prototype.removeChild = function (ix) {
        return this._children.splice(ix, 1);
    };
    UI.prototype.attributes = function (properties, merge) {
        if (merge === void 0) { merge = false; }
        if (!properties)
            return this._attributes;
        if (!merge) {
            for (var prop in this._attributes)
                delete this._attributes[prop];
        }
        for (var prop in properties)
            this._attributes[prop] = properties[prop];
        return this;
    };
    UI.prototype.attribute = function (property, value) {
        if (value === undefined)
            return this._attributes[property];
        this._attributes[property] = value;
        return this;
    };
    UI.prototype.removeAttribute = function (property) {
        delete this._attributes[property];
        return this;
    };
    UI.prototype.events = function (events, merge) {
        if (merge === void 0) { merge = false; }
        if (!events)
            return this._events;
        if (!merge) {
            for (var event_4 in this._events)
                delete this._events[event_4];
        }
        for (var event_5 in events)
            this._events[event_5] = events[event_5];
        return this;
    };
    UI.prototype.event = function (event, state) {
        if (state === undefined)
            return this._events[event];
        this._attributes[event] = state;
        return this;
    };
    UI.prototype.removeEvent = function (event) {
        delete this._events[event];
        return this;
    };
    UI.prototype.embed = function (scope) {
        if (scope === void 0) { scope = {}; }
        if (!scope) {
            this._embedded = undefined;
            return this;
        }
        if (scope === true)
            scope = {};
        this._embedded = scope;
        return this;
    };
    UI.prototype.bind = function (binding) {
        this._binding = binding;
        return this;
    };
    return UI;
})();
exports.UI = UI;
// @TODO: Finish reference impl.
// @TODO: Then build bit-generating version
var UIRenderer = (function () {
    function UIRenderer(ixer) {
        this.ixer = ixer;
        this.compiled = 0;
        this._tagCompilers = {};
        this._handlers = [];
    }
    UIRenderer.prototype.compile = function (roots) {
        if (utils_1.DEBUG.RENDERER)
            console.group("ui compile");
        var compiledElems = [];
        for (var _i = 0; _i < roots.length; _i++) {
            var root = roots[_i];
            // @TODO: reparent dynamic roots if needed.
            if (typeof root === "string") {
                var elems = this._compileWrapper(root, compiledElems.length);
                compiledElems.push.apply(compiledElems, elems);
                var base = this.ixer.findOne("ui template", { "ui template: template": root });
                if (!base)
                    continue;
                var parent_1 = base["ui template: parent"];
                if (parent_1) {
                    for (var _a = 0; _a < elems.length; _a++) {
                        var elem = elems[_a];
                        elem.parent = parent_1;
                    }
                }
            }
            else {
                if (!root.ix)
                    root.ix = compiledElems.length;
                compiledElems.push(root);
            }
        }
        if (utils_1.DEBUG.RENDERER)
            console.groupEnd();
        return compiledElems;
    };
    UIRenderer.prototype._compileWrapper = function (template, baseIx, constraints, bindingStack, depth) {
        if (constraints === void 0) { constraints = {}; }
        if (bindingStack === void 0) { bindingStack = []; }
        if (depth === void 0) { depth = 0; }
        var elems = [];
        var binding = this.ixer.findOne("ui template binding", { "ui template binding: template": template });
        if (!binding) {
            var elem = this._compileElement(template, bindingStack, depth);
            if (elem)
                elems[0] = elem;
        }
        else {
            var boundQuery = binding["ui template binding: binding"];
            var facts = this.getBoundFacts(boundQuery, constraints);
            var ix = 0;
            for (var _i = 0; _i < facts.length; _i++) {
                var fact = facts[_i];
                bindingStack.push(fact);
                var elem = this._compileElement(template, bindingStack, depth);
                bindingStack.pop();
                if (elem)
                    elems.push(elem);
            }
        }
        elems.sort(function (a, b) { return a.ix - b.ix; });
        var prevIx = undefined;
        for (var _a = 0; _a < elems.length; _a++) {
            var elem = elems[_a];
            elem.ix = elem.ix ? elem.ix + baseIx : baseIx;
            if (elem.ix === prevIx)
                elem.ix++;
            prevIx = elem.ix;
        }
        return elems;
    };
    UIRenderer.prototype._compileElement = function (template, bindingStack, depth) {
        if (utils_1.DEBUG.RENDERER)
            console.log(utils_1.repeat("  ", depth) + "* compile", template);
        var elementToChildren = this.ixer.index("ui template", ["ui template: parent"]);
        var elementToEmbeds = this.ixer.index("ui embed", ["ui embed: parent"]);
        var embedToScope = this.ixer.index("ui embed scope", ["ui embed scope: embed"]);
        var embedToScopeBinding = this.ixer.index("ui embed scope binding", ["ui embed scope binding: embed"]);
        var elementToAttrs = this.ixer.index("ui attribute", ["ui attribute: template"]);
        var elementToAttrBindings = this.ixer.index("ui attribute binding", ["ui attribute binding: template"]);
        var elementToEvents = this.ixer.index("ui event", ["ui event: template"]);
        this.compiled++;
        var base = this.ixer.findOne("ui template", { "ui template: template": template });
        if (!base) {
            console.warn("ui template " + template + " does not exist. Ignoring.");
            return undefined;
        }
        var attrs = elementToAttrs[template];
        var boundAttrs = elementToAttrBindings[template];
        var events = elementToEvents[template];
        // Handle meta properties
        var elem = { _template: template, ix: base["ui template: ix"] };
        // Handle static properties
        if (attrs) {
            for (var _i = 0; _i < attrs.length; _i++) {
                var _a = attrs[_i], prop = _a["ui attribute: property"], val = _a["ui attribute: value"];
                elem[prop] = val;
            }
        }
        // Handle bound properties
        if (boundAttrs) {
            // @FIXME: What do with source?
            for (var _b = 0; _b < boundAttrs.length; _b++) {
                var _c = boundAttrs[_b], prop = _c["ui attribute binding: property"], source = _c["ui attribute binding: source"], alias = _c["ui attribute binding: alias"];
                elem[prop] = this.getBoundValue(source, alias, bindingStack);
            }
        }
        // Attach event handlers
        if (events) {
            for (var _d = 0; _d < events.length; _d++) {
                var event_6 = events[_d]["ui event: event"];
                elem[event_6] = this.generateEventHandler(elem, event_6, bindingStack);
            }
        }
        // Compile children
        var children = elementToChildren[template] || [];
        var embeds = elementToEmbeds[template] || [];
        if (children.length || embeds.length) {
            elem.children = [];
            var childIx = 0, embedIx = 0;
            while (childIx < children.length || embedIx < embeds.length) {
                var child = children[childIx];
                var embed = embeds[embedIx];
                var add = void 0, constraints = {}, childBindingStack = bindingStack;
                if (!embed || child && child.ix <= embed.ix) {
                    add = children[childIx++]["ui template: template"];
                    // Resolve bound aliases into constraints
                    constraints = this.getBoundScope(bindingStack);
                }
                else {
                    add = embeds[embedIx++]["ui embed: template"];
                    for (var _e = 0, _f = embedToScope[embed["ui embed: embed"]] || []; _e < _f.length; _e++) {
                        var scope = _f[_e];
                        constraints[scope["ui embed scope: key"]] = scope["ui embed scope: value"];
                    }
                    for (var _g = 0, _h = embedToScopeBinding[embed["ui embed: embed"]] || []; _g < _h.length; _g++) {
                        var scope = _h[_g];
                        // @FIXME: What do about source?
                        var key = scope["ui embed scope binding: key"], source = scope["ui embed scope binding: source"], alias = scope["ui embed scope binding: alias"];
                        constraints[key] = this.getBoundValue(source, alias, bindingStack);
                    }
                    childBindingStack = [constraints];
                }
                elem.children.push.apply(elem.children, this._compileWrapper(add, elem.children.length, constraints, childBindingStack, depth + 1));
            }
        }
        if (this._tagCompilers[elem.t]) {
            try {
                this._tagCompilers[elem.t](elem);
            }
            catch (err) {
                console.warn("Failed to compile template: '" + template + "' due to '" + err + "' for element '" + JSON.stringify(elem) + "'");
                elem.t = "ui-error";
            }
        }
        return elem;
    };
    UIRenderer.prototype.getBoundFacts = function (query, constraints) {
        return this.ixer.find(query, constraints);
    };
    UIRenderer.prototype.getBoundScope = function (bindingStack) {
        var scope = {};
        for (var _i = 0; _i < bindingStack.length; _i++) {
            var fact = bindingStack[_i];
            for (var alias in fact)
                scope[alias] = fact[alias];
        }
        return scope;
    };
    //@FIXME: What do about source?
    UIRenderer.prototype.getBoundValue = function (source, alias, bindingStack) {
        for (var ix = bindingStack.length - 1; ix >= 0; ix--) {
            var fact = bindingStack[ix];
            if (source in fact && fact[alias])
                return fact[alias];
        }
    };
    UIRenderer.prototype.generateEventHandler = function (elem, event, bindingStack) {
        var template = elem["_template"];
        var memoKey = template + "::" + event;
        var attrKey = event + "::state";
        elem[attrKey] = this.getEventState(template, event, bindingStack);
        if (this._handlers[memoKey])
            return this._handlers[memoKey];
        var self = this;
        if (event === "change" || event === "input") {
            this._handlers[memoKey] = function (evt, elem) {
                var props = {};
                if (elem.t === "select" || elem.t === "input" || elem.t === "textarea")
                    props.value = evt.target.value;
                if (elem.type === "checkbox")
                    props.value = evt.target.checked;
                self.handleEvent(template, event, evt, elem, props);
            };
        }
        else {
            this._handlers[memoKey] = function (evt, elem) {
                self.handleEvent(template, event, evt, elem, {});
            };
        }
        return this._handlers[memoKey];
    };
    UIRenderer.prototype.handleEvent = function (template, eventName, event, elem, eventProps) {
        var attrKey = eventName + "::state";
        var state = elem[attrKey];
        var content = (_a = ["\n      # ", " ({is a: event})\n      ## Meta\n      event target: {event target: ", "}\n      event template: {event template: ", "}\n      event type: {event type: ", "}\n\n      ## State\n    "], _a.raw = ["\n      # ", " ({is a: event})\n      ## Meta\n      event target: {event target: ", "}\n      event template: {event template: ", "}\n      event type: {event type: ", "}\n\n      ## State\n    "], utils_1.unpad(6)(_a, eventName, elem.id, template, eventName));
        if (state["*event*"]) {
            for (var prop in state["*event*"])
                content += prop + ": {" + prop + ": " + eventProps[state["*event*"][prop]] + "}\n";
        }
        for (var prop in state) {
            if (prop === "*event*")
                continue;
            content += prop + ": {" + prop + ": " + state[prop] + "}\n";
        }
        var changeset = this.ixer.diff();
        var raw = utils_1.uuid();
        var entity = eventName + " event " + raw.slice(-12);
        changeset.add("builtin entity", { entity: entity, content: content });
        this.ixer.applyDiff(changeset);
        console.log(entity);
        var _a;
    };
    UIRenderer.prototype.getEventState = function (template, event, bindingStack) {
        var state = {};
        var staticAttrs = this.ixer.find("ui event state", { "ui event state: template": template, "ui event state: event": event });
        for (var _i = 0; _i < staticAttrs.length; _i++) {
            var _a = staticAttrs[_i], key = _a["ui event state: key"], val = _a["ui event state: value"];
            state[key] = val;
        }
        var boundAttrs = this.ixer.find("ui event state binding", { "ui event state binding: template": template, "ui event state binding: event": event });
        for (var _b = 0; _b < boundAttrs.length; _b++) {
            var _c = boundAttrs[_b], key = _c["ui event state binding: key"], source = _c["ui event state binding: source"], alias = _c["ui event state binding: alias"];
            if (source === "*event*") {
                state["*event*"] = state["*event*"] || {};
                state["*event*"][key] = alias;
            }
            else {
                state[key] = this.getBoundValue(source, alias, bindingStack);
            }
        }
        return state;
    };
    return UIRenderer;
})();
exports.UIRenderer = UIRenderer;
if (this.window)
    window["uiRenderer"] = exports;

},{"./runtime":15,"./utils":19}],18:[function(require,module,exports){
var utils_1 = require("./utils");
var app_1 = require("./app");
var ui_1 = require("./ui");
var masonry_1 = require("./masonry");
//------------------------------------------------------------------------------
// Utilities
//------------------------------------------------------------------------------
function resolveName(maybeId) {
    var display = app_1.eve.findOne("display name", { id: maybeId });
    return display ? display.name : maybeId;
}
exports.resolveName = resolveName;
function resolveId(maybeName) {
    var display = app_1.eve.findOne("display name", { name: maybeName });
    return display ? display.id : maybeName;
}
exports.resolveId = resolveId;
function resolveValue(maybeValue) {
    if (typeof maybeValue !== "string")
        return maybeValue;
    var val = maybeValue.trim();
    if (val.indexOf("=") === 0) {
        // @TODO: Run through the full NLP.
        var search = val.substring(1).trim();
        return resolveId(search);
    }
    return val;
}
exports.resolveValue = resolveValue;
function isEntity(maybeId) {
    return !!app_1.eve.findOne("entity", { entity: maybeId });
}
exports.isEntity = isEntity;
function getNodeContent(node) {
    if (node.nodeName === "INPUT")
        return node.value;
    else
        return node.textContent;
}
exports.getNodeContent = getNodeContent;
function sortByFieldValue(field, direction) {
    if (direction === void 0) { direction = 1; }
    var fwd = direction;
    var back = -1 * direction;
    return function (rowA, rowB) {
        var a = resolveName(resolveValue(rowA[field])), b = resolveName(resolveValue(rowB[field]));
        return (a === b) ? 0 :
            (a === undefined) ? fwd :
                (b === undefined) ? back :
                    (a > b) ? fwd : back;
    };
}
var wordSplitter = /\s+/gi;
var statWeights = { links: 100, pages: 200, words: 1 };
function classifyEntities(rawEntities) {
    var entities = rawEntities.slice();
    var collections = [];
    var systems = [];
    // Measure relatedness + length of entities
    // @TODO: mtimes of entities
    var relatedCounts = {};
    var wordCounts = {};
    var childCounts = {};
    var scores = {};
    for (var _i = 0; _i < entities.length; _i++) {
        var entity_1 = entities[_i];
        var _a = (app_1.eve.findOne("entity", { entity: entity_1 }) || {}).content, content = _a === void 0 ? "" : _a;
        relatedCounts[entity_1] = app_1.eve.find("directionless links", { entity: entity_1 }).length;
        wordCounts[entity_1] = content.trim().replace(wordSplitter, " ").split(" ").length;
        var _b = (app_1.eve.findOne("collection", { collection: entity_1 }) || {}).count, childCount = _b === void 0 ? 0 : _b;
        childCounts[entity_1] = childCount;
        scores[entity_1] =
            relatedCounts[entity_1] * statWeights.links +
                wordCounts[entity_1] * statWeights.words +
                childCounts[entity_1] * statWeights.pages;
    }
    // Separate system entities
    var ix = 0;
    while (ix < entities.length) {
        if (app_1.eve.findOne("is a attributes", { collection: utils_1.builtinId("system"), entity: entities[ix] })) {
            systems.push(entities.splice(ix, 1)[0]);
        }
        else
            ix++;
    }
    // Separate user collections from other entities
    ix = 0;
    while (ix < entities.length) {
        if (childCounts[entities[ix]]) {
            collections.push(entities.splice(ix, 1)[0]);
        }
        else
            ix++;
    }
    return { systems: systems, collections: collections, entities: entities, scores: scores, relatedCounts: relatedCounts, wordCounts: wordCounts, childCounts: childCounts };
}
function getFields(_a) {
    var example = _a.example, whitelist = _a.whitelist, blacklist = _a.blacklist;
    // Determine display fields based on whitelist, blacklist, and the first row
    var fields;
    if (whitelist) {
        fields = whitelist.slice();
    }
    else {
        fields = Object.keys(example);
        if (blacklist) {
            for (var _i = 0; _i < blacklist.length; _i++) {
                var field = blacklist[_i];
                var fieldIx = fields.indexOf(field);
                if (fieldIx !== -1) {
                    fields.splice(fieldIx, 1);
                }
            }
        }
    }
    return fields;
}
exports.getFields = getFields;
//------------------------------------------------------------------------------
// Handlers
//------------------------------------------------------------------------------
function preventDefault(event) {
    event.preventDefault();
}
exports.preventDefault = preventDefault;
function preventDefaultUnlessFocused(event) {
    if (event.target !== document.activeElement)
        event.preventDefault();
}
function closePopup() {
    var popout = app_1.eve.findOne("ui pane", { kind: ui_1.PANE.POPOUT });
    if (popout)
        app_1.dispatch("remove popup", { paneId: popout.pane }).commit();
}
function navigate(event, elem) {
    var paneId = elem.data.paneId;
    if (elem.peek)
        app_1.dispatch("set popout", { parentId: paneId, contains: elem.link, x: event.clientX, y: event.clientY }).commit();
    else
        app_1.dispatch("set pane", { paneId: paneId, contains: elem.link }).commit();
    event.preventDefault();
}
exports.navigate = navigate;
function navigateOrEdit(event, elem) {
    var popout = app_1.eve.findOne("ui pane", { kind: ui_1.PANE.POPOUT });
    var peeking = popout && popout.contains === elem.link;
    if (event.target === document.activeElement) { }
    else if (!peeking)
        navigate(event, elem);
    else {
        closePopup();
        event.target.focus();
    }
}
function blurOnEnter(event, elem) {
    if (event.keyCode === utils_1.KEYS.ENTER) {
        event.target.blur();
        event.preventDefault();
    }
}
//interface TableCellElem extends Element { row: TableRowElem, field: string, rows?: any[]}
//interface TableFieldElem extends Element { table: string, field: string, direction?: number }
function updateEntityValue(event, elem) {
    var value = utils_1.coerceInput(event.detail);
    var tableElem = elem.table, row = elem.row, field = elem.field;
    var entity = tableElem["entity"];
    throw new Error("@TODO: FIXME");
    // let rows = elem.rows || [row];
    // let chain = dispatch();
    // for(let row of rows) {
    //   if(field === "value" && row.value !== value && row.attribute !== undefined) {
    //     chain.dispatch("update entity attribute", {entity, attribute: row.attribute, prev: row.value, value});
    //   } else if(field === "attribute" && row.attribute !== value && row.value !== undefined) {
    //     chain.dispatch("rename entity attribute", {entity, prev: row.attribute, attribute: value, value: row.value});
    //   }
    // }
    // chain.commit();
}
function updateEntityAttributes(event, elem) {
    var _a = elem.row, tableElem = _a.table, row = _a.row;
    var entity = tableElem["entity"];
    if (event.detail === "add") {
        var state = elem["state"]["adder"];
        var valid = elem["fields"].every(function (field) {
            return state[field] !== undefined;
        });
        if (valid) {
            app_1.dispatch("add sourced eav", { entity: entity, attribute: state.attribute, value: resolveValue(state.value) }).commit();
            elem["state"]["adder"] = {};
        }
    }
    else {
        app_1.dispatch("remove entity attribute", { entity: entity, attribute: row.attribute, value: row.value }).commit();
    }
}
function sortTable(event, elem) {
    var table = elem.table, _a = elem.field, field = _a === void 0 ? undefined : _a, _b = elem.direction, direction = _b === void 0 ? undefined : _b;
    console.log(table.state, field, direction);
    if (field === undefined && direction === undefined) {
        field = event.target.value;
    }
    app_1.dispatch("sort table", { state: table.state, field: field, direction: direction }).commit();
}
//------------------------------------------------------------------------------
// Embedded cell representation wrapper
//------------------------------------------------------------------------------
var uitk = this;
function embeddedCell(elem) {
    var children = [];
    var childInfo = elem.childInfo, rep = elem.rep;
    if (childInfo.constructor === Array) {
        for (var _i = 0; _i < childInfo.length; _i++) {
            var child = childInfo[_i];
            child["data"] = child["data"] || childInfo.params;
            children.push(uitk[rep](child));
        }
    }
    else {
        children.push(uitk[rep](childInfo));
    }
    children.push({ c: "edit-button-container", children: [
            { c: "edit-button ion-edit", click: elem.click, cell: elem.cell }
        ] });
    return { c: "non-editing-embedded-cell", children: children, cell: elem.cell };
}
exports.embeddedCell = embeddedCell;
//------------------------------------------------------------------------------
// Representations for cards
//------------------------------------------------------------------------------
// @FIXME: if there isn't an ID here, microReact does the wrong thing, investigate
// after the release
function card(elem) {
    elem.c = "card " + (elem.c || "");
    return elem;
}
exports.card = card;
function toggleAddTile(event, elem) {
    app_1.dispatch("toggle add tile", { key: elem.key, entityId: elem.entityId }).commit();
}
function setTileAdder(event, elem) {
    app_1.dispatch("set tile adder", { key: elem.key, adder: elem.adder }).commit();
}
function entity(elem) {
    var entityId = elem.entity;
    var paneId = elem.data.paneId;
    var key = elem.key || entityId + "|" + paneId;
    var state = ui_1.uiState.widget.card[key] || {};
    var name = app_1.eve.findOne("display name", { id: ui_1.asEntity(entityId) }).name;
    var attrs = ui_1.entityTilesUI(entityId, paneId, key);
    attrs.c += " page-attributes";
    // let editor = pageEditor(entityId, paneId, elem.editor);
    var adder = tileAdder({ entityId: entityId, key: key });
    return { c: "entity " + (state.showAdd ? "adding" : ""), children: [
            { c: "header", children: [
                    { text: name },
                    { c: "ion-android-add add-tile", click: toggleAddTile, key: key, entityId: entityId }
                ] },
            adder,
            attrs,
        ] };
}
exports.entity = entity;
var measureSpan = document.createElement("span");
measureSpan.className = "measure-span";
document.body.appendChild(measureSpan);
function autosizeInput(node, elem) {
    var minWidth = 50;
    measureSpan.style.fontSize = window.getComputedStyle(node, null)["font-size"];
    measureSpan.textContent = node.value;
    var measuredWidth = measureSpan.getBoundingClientRect().width;
    node.style.width = Math.ceil(Math.max(minWidth, measuredWidth)) + 5 + "px";
}
exports.autosizeInput = autosizeInput;
function autosizeAndFocus(node, elem) {
    autosizeInput(node, elem);
    utils_1.autoFocus(node, elem);
}
exports.autosizeAndFocus = autosizeAndFocus;
function trackPropertyAdderInput(event, elem) {
    var value = event.currentTarget.value;
    app_1.dispatch("set tile adder attribute", { key: elem.key, attribute: elem.attribute, value: value }).commit();
    if (event.currentTarget.nodeName === "INPUT") {
        autosizeInput(event.currentTarget, elem);
    }
}
function adderKeys(event, elem) {
    if (event.keyCode === utils_1.KEYS.ENTER) {
        app_1.dispatch("submit tile adder", { key: elem.key, node: event.currentTarget }).commit();
    }
    else if (event.keyCode === utils_1.KEYS.ESC) {
        app_1.dispatch("toggle add tile", { key: elem.key }).commit();
    }
}
function submitAdder(event, elem) {
    // @HACK: yeah...
    app_1.dispatch("submit tile adder", { key: elem.key, node: event.currentTarget.parentNode.parentNode.firstChild.firstChild }).commit();
}
function submitProperty(adder, state, node) {
    app_1.dispatch("add sourced eav", { entity: state.entityId, attribute: state.propertyProperty, value: state.propertyValue, forceEntity: true }).commit();
    state.propertyValue = "";
    state.propertyProperty = "";
    //make sure the focus is in the value
    node.parentNode.firstChild.focus();
}
function propertyAdderUI(elem) {
    var entityId = elem.entityId, key = elem.key;
    var state = ui_1.uiState.widget.card[key] || {};
    return { c: "property-adder", children: [
            { children: [
                    { c: "tile small", children: [
                            { c: "tile-content-wrapper", children: [
                                    { t: "input", c: "property", placeholder: "property", value: state.propertyProperty, attribute: "propertyProperty", input: trackPropertyAdderInput, postRender: autosizeAndFocus, keydown: adderKeys, entityId: entityId, key: key },
                                    { t: "input", c: "value", placeholder: "value", value: state.propertyValue, attribute: "propertyValue", input: trackPropertyAdderInput, postRender: autosizeInput, keydown: adderKeys, entityId: entityId, key: key },
                                ] },
                            { c: "controls flex-row", children: [
                                    { c: "ion-checkmark submit", click: submitAdder, key: key },
                                    { c: "ion-close cancel", click: setTileAdder, key: key },
                                ] }
                        ] }
                ] }
        ] };
}
function descriptionAdderUI(elem) {
    var entityId = elem.entityId, key = elem.key;
    var state = ui_1.uiState.widget.card[key] || {};
    return { c: "property-adder description-adder", children: [
            { children: [
                    { c: "tile full", children: [
                            { c: "tile-content-wrapper", children: [
                                    { t: "textarea", c: "value", placeholder: "description", value: state.descriptionValue, attribute: "descriptionValue", input: trackPropertyAdderInput, postRender: utils_1.autoFocus, keydown: adderKeys, entityId: entityId, key: key },
                                ] },
                            { c: "controls flex-row", children: [
                                    { c: "ion-checkmark submit", click: submitAdder, key: key },
                                    { c: "ion-close cancel", click: setTileAdder, key: key },
                                ] }
                        ] },
                ] }
        ] };
}
function submitDescription(adder, state, node) {
    var chain = app_1.dispatch("add sourced eav", { entity: state.entityId, attribute: "description", value: state.descriptionValue });
    state.descriptionValue = "";
    chain.dispatch("toggle add tile", { key: state.key }).commit();
}
function autosizeAndStoreListTileItem(event, elem) {
    var node = event.currentTarget;
    app_1.dispatch("add active tile item", { cardId: elem.cardId, attribute: elem.storeAttribute, tileId: elem.tileId, id: elem.storeId, value: node.value }).commit();
    autosizeInput(node, elem);
}
function collectionTileAdder(elem) {
    var values = elem.values, data = elem.data, tileId = elem.tileId, attribute = elem.attribute, cardId = elem.cardId, entityId = elem.entityId, forceActive = elem.forceActive, reverseEntityAndValue = elem.reverseEntityAndValue, noProperty = elem.noProperty, _a = elem.rep, rep = _a === void 0 ? "value" : _a, _b = elem.c, klass = _b === void 0 ? "" : _b;
    tileId = tileId || attribute;
    var state = ui_1.uiState.widget.card[cardId] || {};
    var listChildren = [];
    var added = (state.activeTile ? state.activeTile.itemsToAdd : false) || [];
    var ix = 0;
    for (var _i = 0; _i < added.length; _i++) {
        var add = added[_i];
        listChildren.push({ c: "value", children: [
                { t: "input", placeholder: "add", value: add, attribute: attribute, entityId: entityId, storeAttribute: "itemsToAdd", storeId: ix, cardId: cardId, input: autosizeAndStoreListTileItem, postRender: autosizeAndFocus, keydown: adderKeys, key: cardId }
            ] });
        ix++;
    }
    listChildren.push({ c: "value", children: [
            { t: "input", placeholder: "add item", value: "", attribute: attribute, entityId: entityId, storeAttribute: "itemsToAdd", storeId: ix, cardId: cardId, input: autosizeAndStoreListTileItem, postRender: ix === 0 ? autosizeAndFocus : autosizeInput, keydown: adderKeys, key: cardId }
        ] });
    var size = "full";
    var tileChildren = [];
    tileChildren.push({ t: "input", c: "property", placeholder: "collection name", attribute: "collectionProperty", value: state.collectionProperty, input: trackPropertyAdderInput, key: cardId });
    tileChildren.push({ c: "list", children: listChildren });
    return { c: "property-adder collection-adder", children: [
            { children: [
                    { c: "tile full", children: [
                            { c: "tile-content-wrapper", children: tileChildren },
                            { c: "controls flex-row", children: [
                                    { c: "ion-checkmark submit", click: submitAdder, key: cardId },
                                    { c: "ion-close cancel", click: setTileAdder, key: cardId },
                                ] }
                        ] },
                ] }
        ] };
}
function collectionAdderUI(elem) {
    var entityId = elem.entityId, key = elem.key;
    var state = ui_1.uiState.widget.card[key] || {};
    var tile = collectionTileAdder({ values: [], cardId: key, entityId: entityId, forceActive: true, tileId: "collectionAdder", data: {}, noProperty: true, });
    return tile;
}
function submitCollection(adder, state, node) {
    var chain;
    console.log("SUBMIT COLL", state.key);
    // determine whether this is making the current entity a collection, or if this is just a normal collection.
    if (!state.collectionProperty || pluralize(state.collectionProperty.trim(), 1).toLowerCase() === resolveName(state.entityId).toLowerCase()) {
        // this is turning the current entity into a collection
        chain = app_1.dispatch("submit list tile", { cardId: state.key, attribute: "is a", entityId: state.entityId, reverseEntityAndValue: true });
    }
    else {
        chain = app_1.dispatch("submit list tile", { cardId: state.key, attribute: state.collectionProperty, entityId: state.entityId, reverseEntityAndValue: false });
    }
    state.collectionProperty = undefined;
    chain.dispatch("toggle add tile", { key: state.key }).commit();
    console.log(JSON.stringify(state));
}
function imageAdderUI(elem) {
    var entityId = elem.entityId, key = elem.key;
    var state = ui_1.uiState.widget.card[key] || {};
    return { c: "property-adder image-adder", children: [
            { children: [
                    { c: "tile small", children: [
                            { c: "tile-content-wrapper", children: [
                                    { t: "input", c: "value", placeholder: "image url", value: state.propertyValue, attribute: "imageValue", input: trackPropertyAdderInput, postRender: autosizeAndFocus, keydown: adderKeys, entityId: entityId, key: key },
                                ] },
                            { c: "controls flex-row", children: [
                                    { c: "ion-checkmark submit", click: submitAdder, key: key },
                                    { c: "ion-close cancel", click: setTileAdder, key: key },
                                ] }
                        ] }
                ] }
        ] };
}
function submitImage(adder, state, node) {
    var chain = app_1.dispatch("add sourced eav", { entity: state.entityId, attribute: "image", value: "\"" + state.imageValue + "\"" });
    state.imageValue = undefined;
    chain.dispatch("toggle add tile", { key: state.key }).commit();
}
function comingSoonAdderUI(elem) {
    var entityId = elem.entityId, key = elem.key;
    var state = ui_1.uiState.widget.card[key] || {};
    return { c: "property-adder", children: [
            { children: [
                    { c: "tile small", children: [
                            { c: "tile-content-wrapper", children: [
                                    { text: "This tile type is coming soon." }
                                ] },
                            { c: "controls flex-row", children: [
                                    { c: "ion-close cancel", click: setTileAdder, key: key },
                                ] }
                        ] }
                ] }
        ] };
}
function tileAdder(elem) {
    var entityId = elem.entityId, key = elem.key;
    var state = ui_1.uiState.widget.card[key] || {};
    var rows = [];
    var klass = "";
    if (!state.adder) {
        var adders = [
            { name: "Property", icon: "ion-compose", ui: propertyAdderUI, submit: submitProperty },
            { name: "Description", icon: "ion-drag", ui: descriptionAdderUI, submit: submitDescription },
            { name: "Collection", klass: "collection", icon: "ion-ios-list-outline", ui: collectionAdderUI, submit: submitCollection },
            { name: "Image", icon: "ion-image", ui: imageAdderUI, submit: submitImage },
            { name: "Document", icon: "ion-document", ui: comingSoonAdderUI },
            { name: "Computed", icon: "ion-calculator", ui: comingSoonAdderUI },
        ];
        var count = 0;
        var curRow = { c: "row flex-row", children: [] };
        for (var _i = 0; _i < adders.length; _i++) {
            var adder = adders[_i];
            curRow.children.push({ c: "tile small", adder: adder, key: key, click: setTileAdder, children: [
                    { c: "tile-content-wrapper", children: [
                            { c: "property", text: adder.name },
                            { c: "value " + adder.icon },
                        ] }
                ] });
            count++;
            if (curRow.children.length === 3 || count === adders.length) {
                rows.push(curRow);
                curRow = { c: "row flex-row", children: [] };
            }
        }
    }
    else {
        var adderElem = { entityId: entityId, key: key };
        if (state.adder.ui) {
            rows.push(state.adder.ui(adderElem));
        }
        klass = state.adder.klass || "";
    }
    return { c: "tile-adder " + klass, children: rows };
}
exports.tileAdder = tileAdder;
function pageEditor(entityId, paneId, elem) {
    var _a = (app_1.eve.findOne("entity", { entity: entityId }) || {}).content, content = _a === void 0 ? undefined : _a;
    var page = app_1.eve.findOne("entity page", { entity: entityId })["page"];
    var name = resolveName(entityId);
    elem.c = "wiki-editor " + (elem.c || "");
    elem.meta = { entityId: entityId, page: page, paneId: paneId };
    elem.options.noFocus = true;
    elem.value = content;
    elem.children = elem.cellItems;
    return elem;
}
exports.pageEditor = pageEditor;
//------------------------------------------------------------------------------
// Representations for Errors
//------------------------------------------------------------------------------
function error(elem) {
    elem.c = "error-rep " + (elem.c || "");
    return elem;
}
exports.error = error;
function name(elem) {
    var entity = elem.entity;
    var _a = (app_1.eve.findOne("display name", { id: entity }) || {}).name, name = _a === void 0 ? entity : _a;
    elem.text = name;
    elem.c = "entity " + (elem.c || "");
    return elem;
}
exports.name = name;
function link(elem) {
    var entity = elem.entity;
    var name = resolveName(entity);
    elem.c = (elem.c || "") + " entity link inline";
    elem.text = elem.text || name;
    elem["link"] = elem["link"] || entity;
    elem.click = elem.click || navigate;
    elem["peek"] = elem["peek"] !== undefined ? elem["peek"] : true;
    return elem;
}
exports.link = link;
function attributes(elem) {
    var entity = elem.entity;
    var attributes = [];
    for (var _i = 0, _a = app_1.eve.find("entity eavs", { entity: entity }); _i < _a.length; _i++) {
        var eav = _a[_i];
        attributes.push({ attribute: eav.attribute, value: eav.value });
    }
    attributes.sort(function (a, b) {
        if (a.attribute === b.attribute)
            return 0;
        else if (a.attribute < b.attribute)
            return -1;
        return 1;
    });
    elem["groups"] = ["attribute"];
    elem["rows"] = attributes;
    elem["editCell"] = updateEntityValue;
    elem["editRow"] = updateEntityAttributes;
    elem["noHeader"] = true;
    return table(elem);
}
exports.attributes = attributes;
function related(elem) {
    var entity = elem.entity, _a = elem.data, data = _a === void 0 ? undefined : _a;
    var name = resolveName(entity);
    var relations = [];
    for (var _i = 0, _b = app_1.eve.find("directionless links", { entity: entity }); _i < _b.length; _i++) {
        var link_1 = _b[_i];
        relations.push(link_1.link);
    }
    elem.c = elem.c !== undefined ? elem.c : "flex-row flex-wrap csv";
    if (relations.length) {
        elem.children = [{ t: "h2", text: name + " is related to " + relations.length + " " + pluralize("entities", relations.length) + ":" }];
        for (var _c = 0; _c < relations.length; _c++) {
            var rel = relations[_c];
            elem.children.push(link({ entity: rel, data: data }));
        }
    }
    else
        elem.text = name + " is not related to any other entities.";
    return elem;
}
exports.related = related;
function index(elem) {
    var entity = elem.entity;
    var name = resolveName(entity);
    var facts = app_1.eve.find("is a attributes", { collection: entity });
    var list = { t: "ul", children: [] };
    for (var _i = 0; _i < facts.length; _i++) {
        var fact = facts[_i];
        list.children.push(link({ t: "li", entity: fact.entity, data: elem.data }));
    }
    elem.children = [
        { t: "h2", text: "There " + pluralize("are", facts.length) + " " + facts.length + " " + pluralize(name, facts.length) + ":" },
        list
    ];
    return elem;
}
exports.index = index;
function view(elem) {
    var entity = elem.entity;
    var name = resolveName(entity);
    // @TODO: Check if given entity is a view, or render an error
    var rows = app_1.eve.find(entity);
    elem["rows"] = rows;
    return table(elem);
}
exports.view = view;
function results(elem) {
    var entity = elem.entity, _a = elem.data, data = _a === void 0 ? undefined : _a;
    elem.children = [name({ entity: entity, data: data })];
    for (var _i = 0, _b = app_1.eve.find("entity eavs", { entity: entity, attribute: "artifact" }); _i < _b.length; _i++) {
        var eav = _b[_i];
        elem.children.push(name({ t: "h3", entity: eav.value, data: data }), view({ entity: eav.value, data: data }));
    }
    return elem;
}
exports.results = results;
function value(elem) {
    var _a = elem.text, val = _a === void 0 ? "" : _a, value = elem.value, _b = elem.autolink, autolink = _b === void 0 ? true : _b, _c = elem.editable, editable = _c === void 0 ? false : _c;
    var field = "text";
    if (editable && value) {
        field = "value";
        val = value;
    }
    elem["original"] = val;
    var cleanup;
    if (isEntity(val)) {
        elem["entity"] = ui_1.asEntity(val);
        elem[field] = resolveName(val);
        if (autolink)
            elem = link(elem);
        if (editable && autolink) {
            elem.mousedown = preventDefaultUnlessFocused;
            elem.click = navigateOrEdit;
            cleanup = closePopup;
        }
    }
    if (editable) {
        if (elem.t !== "input") {
            elem.contentEditable = true;
        }
        elem.placeholder = "<empty>";
        var _blur = elem.blur;
        elem.blur = function (event, elem) {
            var node = event.target;
            if (_blur)
                _blur(event, elem);
            if (node.value === "= " + elem.value)
                node.value = elem.value;
            if (isEntity(elem.value))
                node.classList.add("link");
            if (cleanup)
                cleanup(event, elem);
        };
        var _focus = elem.focus;
        elem.focus = function (event, elem) {
            var node = event.target;
            if (elem.value !== val) {
                node.value = "= " + elem.value;
                node.classList.remove("link");
            }
            if (_focus)
                _focus(event, elem);
        };
    }
    return elem;
}
exports.value = value;
function CSV(elem) {
    var values = elem.values, _a = elem.autolink, autolink = _a === void 0 ? undefined : _a, data = elem.data;
    return { c: "flex-row csv", children: values.map(function (val) { return value({ t: "span", autolink: autolink, text: val, data: data }); }) };
}
exports.CSV = CSV;
function tableBody(elem) {
    var state = elem.state, rows = elem.rows, fields = elem.fields, data = elem.data, _a = elem.groups, groups = _a === void 0 ? [] : _a;
    fields = fields.slice();
    if (!rows.length) {
        elem.text = "<Empty Table>";
        return elem;
    }
    var disabled = {};
    for (var _i = 0, _b = elem.disabled || []; _i < _b.length; _i++) {
        var field_1 = _b[_i];
        disabled[field_1] = true;
    }
    // Strip grouped fields out of display fields -- the former implies the latter and must be handled first
    for (var _c = 0; _c < groups.length; _c++) {
        var field_2 = groups[_c];
        var fieldIx = fields.indexOf(field_2);
        if (fieldIx !== -1) {
            fields.splice(fieldIx, 1);
        }
    }
    // Manage interactivity
    var _d = elem.sortable, sortable = _d === void 0 ? false : _d, editCell = elem.editCell, editGroup = elem.editGroup, removeRow = elem.removeRow;
    if (editCell) {
        var _editCell = editCell;
        editCell = function (event, elem) {
            var val = resolveValue(getNodeContent(event.target));
            if (val === elem["original"])
                return;
            _editCell(new CustomEvent("editcell", { detail: val }), elem);
        };
        var _editGroup = editGroup;
        editGroup = function (event, elem) {
            var val = resolveValue(getNodeContent(event.target));
            if (val === elem["original"])
                return;
            if (_editGroup)
                _editGroup(new CustomEvent("editgroup", { detail: val }), elem);
            else {
                for (var _i = 0, _a = elem.rows; _i < _a.length; _i++) {
                    var row = _a[_i];
                    _editCell(new CustomEvent("editcell", { detail: val }), elem);
                }
            }
        };
    }
    // Sort rows
    if (sortable && state.sortField) {
        rows.sort(sortByFieldValue(state.sortField, state.sortDirection));
    }
    for (var _e = 0; _e < groups.length; _e++) {
        var field = groups[_e];
        rows.sort(sortByFieldValue(field, field === state.sortField ? state.sortDirection : 1));
    }
    elem.children = [];
    var body = elem;
    var openRows = {};
    var openVals = {};
    for (var _f = 0; _f < rows.length; _f++) {
        var row = rows[_f];
        var group = void 0;
        for (var _g = 0; _g < groups.length; _g++) {
            var field_3 = groups[_g];
            if (openVals[field_3] === row[field_3]) {
                group = openRows[field_3];
                group.rows.push(row);
            }
            else {
                openVals[field_3] = row[field_3];
                var cur = openRows[field_3] = {
                    c: "table-row grouped",
                    children: [
                        value({
                            c: "column cell",
                            table: elem,
                            field: field_3,
                            rows: [row],
                            text: row[field_3] || "",
                            data: data,
                            editable: !!editGroup && !disabled[field_3],
                            keydown: blurOnEnter,
                            blur: editGroup
                        }),
                        { c: "flex-column group", children: [] }
                    ]
                };
                if (group) {
                    group.children[1].children.push(cur);
                }
                else {
                    body.children.push(cur);
                }
                group = cur;
            }
        }
        var rowItem = { c: "table-row", children: [] };
        for (var _h = 0; _h < fields.length; _h++) {
            var field_4 = fields[_h];
            rowItem.children.push(value({
                c: "column cell",
                table: elem,
                field: field_4,
                row: row,
                text: row[field_4] || "",
                data: data,
                editable: !!editCell && !disabled[field_4],
                keydown: blurOnEnter,
                blur: editCell
            }));
        }
        rowItem.children.push({ c: "controls", children: [
                removeRow ? { c: "ion-icon-android-close", row: rowItem, click: removeRow } : undefined
            ] });
        if (group) {
            group.children[1].children.push(rowItem);
        }
        else {
            body.children.push(rowItem);
        }
    }
    elem.c = "table-body " + (elem.c || "");
    return elem;
}
exports.tableBody = tableBody;
function tableHeader(elem) {
    var state = elem.state, fields = elem.fields, _a = elem.groups, groups = _a === void 0 ? [] : _a, _b = elem.sortable, sortable = _b === void 0 ? false : _b, data = elem.data;
    // Build header
    elem.t = "header";
    elem.c = "table-header " + (elem.c || "");
    elem.children = [];
    for (var _i = 0, _c = groups.concat(fields); _i < _c.length; _i++) {
        var field = _c[_i];
        var isActive = field === state.sortField;
        var direction = isActive ? state.sortDirection : 0;
        var klass = "sort-toggle " + (isActive && direction < 0 ? "ion-arrow-up-b" : "ion-arrow-down-b") + " " + (isActive ? "active" : "");
        elem.children.push({ c: "column field", children: [
                value({ c: "text", text: field, data: data, autolink: false }),
                { c: "flex-grow" },
                { c: "controls", children: [
                        sortable ? { c: klass, table: elem, field: field, direction: -direction || 1, click: sortTable } : undefined
                    ] }
            ] });
    }
    ;
    elem.children.push({ c: "controls", children: [] });
    return elem;
}
function tableAdderRow(elem) {
    var row = elem.row, fields = elem.fields, _a = elem.confirm, confirm = _a === void 0 ? true : _a, change = elem.change, submit = elem.submit, data = elem.data;
    elem.c = "table-row table-adder " + (elem.c || "");
    elem.children = [];
    var disabled = {};
    for (var _i = 0, _b = elem.disabled || []; _i < _b.length; _i++) {
        var field = _b[_i];
        disabled[field] = true;
    }
    // By default, accept all changes
    if (!change) {
        change = function (event, cellElem) {
            row[cellElem.field] = resolveValue(getNodeContent(event.target));
        };
    }
    // Wrap submission to point at the adder element instead of the add button
    if (submit) {
        var _submit = submit;
        submit = function (event, _) { return _submit(event, elem); };
    }
    // If we should add without confirmation, submit whenever the row is completely filled in
    if (!confirm && submit) {
        var _change = change;
        change = function (event, cellElem) {
            var valid = !_change(event, cellElem);
            for (var _i = 0; _i < fields.length; _i++) {
                var field = fields[_i];
                if (row[field] === undefined)
                    valid = false;
            }
            if (valid)
                submit(event, elem);
        };
    }
    for (var _c = 0; _c < fields.length; _c++) {
        var field = fields[_c];
        elem.children.push(value({
            c: "column cell " + (disabled[field] ? "disabled" : ""),
            table: elem,
            field: field,
            row: row,
            editable: !disabled[field],
            text: row[field] || "",
            data: data,
            keydown: blurOnEnter,
            blur: change
        }));
    }
    if (confirm) {
        elem.children.push({ c: "controls", children: [{ c: "confirm-row ion-checkmark-round", table: elem, row: row, click: submit }] });
    }
    return elem;
}
exports.tableAdderRow = tableAdderRow;
function changeAttributeAdder(event, elem) {
    var tableElem = elem.table, row = elem.row, field = elem.field;
    row[elem.field] = resolveValue(getNodeContent(event.target));
    app_1.dispatch("rerender");
}
function changeEntityAdder(event, elem) {
    var tableElem = elem.table, row = elem.row, field = elem.field;
    var subject = tableElem.subject, fieldMap = tableElem.fieldMap;
    row[elem.field] = resolveValue(getNodeContent(event.target));
    if (elem.field === subject) {
        // @NOTE: Should this really be done by inserting "= " when the input is focused?
        var entityId = ui_1.asEntity(resolveValue(row[subject]));
        if (entityId) {
            for (var field_5 in fieldMap) {
                var _a = (app_1.eve.findOne("entity eavs", { entity: entityId, attribute: fieldMap[field_5] }) || {}).value, value_1 = _a === void 0 ? undefined : _a;
                if (!row[field_5] && value_1 !== undefined) {
                    row[field_5] = value_1;
                }
            }
            app_1.dispatch("rerender");
        }
    }
}
function submitTableAdder(event, elem) {
    var row = elem.row, subject = elem.subject, entity = elem.entity, fieldMap = elem.fieldMap, collections = elem.collections;
    var chain = app_1.dispatch("rerender");
    var name = row[subject];
    if (!entity) {
        entity = ui_1.asEntity(name);
    }
    if (!entity) {
        entity = utils_1.uuid();
        var pageId = utils_1.uuid();
        console.log(" - creating entity", entity);
        chain.dispatch("create page", { page: pageId, content: "" })
            .dispatch("create entity", { entity: entity, name: name, page: pageId });
    }
    for (var field in fieldMap) {
        console.log(" - adding attr", fieldMap[field], "=", uitk.resolveValue(row[field]), "for", entity);
        chain.dispatch("add sourced eav", { entity: entity, attribute: fieldMap[field], value: uitk.resolveValue(row[field]) });
    }
    if (collections) {
        for (var _i = 0; _i < collections.length; _i++) {
            var coll = collections[_i];
            console.log(" - adding coll", "is a", "=", coll, "for", entity);
            chain.dispatch("add sourced eav", { entity: entity, attribute: "is a", value: coll });
        }
    }
    elem.state.adder = {};
    console.log(chain);
    chain.commit();
}
function updateRowAttribute(event, elem) {
    var field = elem.field, row = elem.row, tableElem = elem.table;
    var subject = tableElem.subject, fieldMap = tableElem.fieldMap;
    var entity = row[subject];
    app_1.dispatch("update entity attribute", { entity: entity, attribute: fieldMap[field], prev: row[field], value: event.detail }).commit();
}
function table(elem) {
    var state = elem.state, rows = elem.rows, fields = elem.fields, groups = elem.groups, disabled = elem.disabled, sortable = elem.sortable, editCell = elem.editCell, data = elem.data;
    elem.c = "table-wrapper table " + (elem.c || "");
    elem.children = [
        tableHeader({ state: state, fields: fields, groups: groups, sortable: sortable, data: data }),
        tableBody({ rows: rows, state: state, fields: fields, groups: groups, disabled: disabled, sortable: sortable, editCell: editCell, data: data })
    ];
    return elem;
}
exports.table = table;
function mappedTable(elem) {
    var state = elem.state, entity = elem.entity, subject = elem.subject, fieldMap = elem.fieldMap, collections = elem.collections, data = elem.data;
    // If we're mapped to an entity search we can only add new attributes to that entity
    if (entity && state.adder[subject] !== entity) {
        state.adder[subject] = entity;
    }
    var rows = elem.rows, fields = elem.fields, groups = elem.groups, _a = elem.disabled, disabled = _a === void 0 ? [subject] : _a, _b = elem.sortable, sortable = _b === void 0 ? true : _b;
    var adderChanged = entity ? changeAttributeAdder : changeEntityAdder;
    var adderDisabled = entity ? [subject] : undefined;
    elem.c = "table-wrapper mapped-table " + (elem.c || "");
    elem.children = [
        tableHeader({ state: state, fields: fields, groups: groups, sortable: sortable, data: data }),
        tableBody({ rows: rows, state: state, fields: fields, groups: groups, disabled: disabled, sortable: sortable, subject: subject, fieldMap: fieldMap, editCell: updateRowAttribute, data: data }),
        tableAdderRow({ row: state.adder, state: state, fields: fields, disabled: adderDisabled, subject: subject, fieldMap: fieldMap, collections: collections, change: adderChanged, submit: submitTableAdder })
    ];
    return elem;
}
exports.mappedTable = mappedTable;
function tableFilter(elem) {
    var key = elem.key, _a = elem.search, search = _a === void 0 ? undefined : _a, _b = elem.sortFields, sortFields = _b === void 0 ? undefined : _b;
    elem.children = [];
    if (sortFields) {
        var state = ui_1.uiState.widget.table[key] || { sortField: undefined, sortDirection: undefined };
        var sortOpts = [];
        for (var _i = 0; _i < sortFields.length; _i++) {
            var field = sortFields[_i];
            sortOpts.push({ t: "option", text: resolveName(field), value: field, selected: field === state.sortField });
        }
        elem.children.push({ c: "flex-grow" });
        elem.children.push({ c: "sort", children: [
                { text: "Sort by" },
                { t: "select", c: "select-sort-field select", value: state.sortField, children: sortOpts, key: key, change: sortTable },
                { c: "toggle-sort-dir " + (state.sortDirection === -1 ? "ion-arrow-up-b" : "ion-arrow-down-b"), key: key, direction: -state.sortDirection || 1, click: sortTable },
            ] });
    }
    elem.c = "table-filter " + (elem.c || "");
    return elem;
}
exports.tableFilter = tableFilter;
function externalLink(elem) {
    elem.t = "a";
    elem.c = "link " + (elem.c || "");
    elem.href = elem.url;
    elem.text = elem.text || elem.url;
    return elem;
}
exports.externalLink = externalLink;
function externalImage(elem) {
    elem.t = "img";
    elem.c = "img " + (elem.c || "");
    elem.src = elem.url;
    return elem;
}
exports.externalImage = externalImage;
function externalVideo(elem) {
    var ext = elem.url.slice(elem.url.lastIndexOf(".")).trim().toLowerCase();
    var domain = elem.url.slice(elem.url.indexOf("//") + 2).split("/")[0];
    var isFile = ["mp4", "ogv", "webm", "mov", "avi", "flv"].indexOf(ext) !== -1;
    if (isFile) {
        elem.t = "video";
    }
    else {
        elem.t = "iframe";
    }
    elem.c = "video " + (elem.c || "");
    elem.src = elem.url;
    elem.allowfullscreen = true;
    return elem;
}
exports.externalVideo = externalVideo;
function collapsible(elem) {
    if (elem.key === undefined)
        throw new Error("Must specify a key to maintain collapsible state");
    var state = ui_1.uiState.widget.collapsible[elem.key] || { open: elem.open !== undefined ? elem.open : true };
    var content = { children: elem.children };
    var header = { t: "header", children: [{ c: "collapse-toggle " + (state.open ? "ion-chevron-up" : "ion-chevron-down"), collapsible: elem.key, open: state.open, click: toggleCollapse }, elem.header] };
    elem.c = "collapsible " + (elem.c || "");
    elem.children = [header, state.open ? content : undefined];
    return elem;
}
exports.collapsible = collapsible;
function toggleCollapse(evt, elem) {
    app_1.dispatch("toggle collapse", { collapsible: elem.collapsible, open: !elem.open });
}
var directoryTileLayouts = [
    { size: 4, c: "big", format: function (elem) {
            elem.children.unshift;
            elem.children.push({ text: "(" + elem["stats"][elem["stats"].best] + " " + elem["stats"].best + ")" });
            return elem;
        } },
    { size: 2, c: "detailed", format: function (elem) {
            elem.children.push({ text: "(" + elem["stats"][elem["stats"].best] + " " + elem["stats"].best + ")" });
            return elem;
        } },
    { size: 1, c: "normal", grouped: 2 }
];
var directoryTileStyles = ["tile-style-1", "tile-style-2", "tile-style-3", "tile-style-4", "tile-style-5", "tile-style-6", "tile-style-7"];
function directory(elem) {
    var MAX_ENTITIES_BEFORE_OVERFLOW = 14;
    var rawEntities = elem.entities, _a = elem.data, data = _a === void 0 ? undefined : _a;
    var _b = classifyEntities(rawEntities), systems = _b.systems, collections = _b.collections, entities = _b.entities, scores = _b.scores, relatedCounts = _b.relatedCounts, wordCounts = _b.wordCounts, childCounts = _b.childCounts;
    var sortByScores = utils_1.sortByLookup(scores);
    entities.sort(sortByScores);
    collections.sort(sortByScores);
    systems.sort(sortByScores);
    // Link to entity
    // Peek with most significant statistic (e.g. 13 related; or 14 childrenpages; or 5000 words)
    // Slider pane will all statistics
    // Click opens popup preview
    function formatTile(entity) {
        var stats = { best: "", links: relatedCounts[entity], pages: childCounts[entity], words: wordCounts[entity] };
        var maxContribution = 0;
        for (var stat in stats) {
            if (!statWeights[stat])
                continue;
            var contribution = stats[stat] * statWeights[stat];
            if (contribution > maxContribution) {
                maxContribution = contribution;
                stats.best = stat;
            }
        }
        return { size: scores[entity], stats: stats, children: [
                link({ entity: entity, data: data })
            ] };
    }
    function formatOverflow(key, entities, skipChildren) {
        if (skipChildren === void 0) { skipChildren = false; }
        var rows = [];
        for (var _i = 0; _i < entities.length; _i++) {
            var entity_2 = entities[_i];
            rows.push({
                name: entity_2,
                score: scores[entity_2],
                words: wordCounts[entity_2],
                links: relatedCounts[entity_2],
                pages: childCounts[entity_2]
            });
            if (skipChildren)
                delete rows[rows.length - 1].pages;
        }
        var state = {};
        var fields = getFields({ example: rows[0], blacklist: ["__id"] });
        return table({ c: "overflow-list", key: key, rows: rows, fields: fields, sortable: true, state: state, data: data });
    }
    // @TODO: Put formatOverflow into a collapsed container.
    return { c: "directory flex-column", children: [
            { t: "h2", text: "Collections" },
            exports.masonry({ c: "directory-listing", layouts: directoryTileLayouts, styles: directoryTileStyles, children: collections.map(formatTile) }),
            { t: "h2", text: "Entities" },
            exports.masonry({ c: "directory-listing", layouts: directoryTileLayouts, styles: directoryTileStyles, children: entities.slice(0, MAX_ENTITIES_BEFORE_OVERFLOW).map(formatTile) }),
            collapsible({
                key: elem.key + "|directory entities collapsible",
                header: { text: "Show all entities..." },
                children: [
                    //tableFilter({key: `${elem.key}|directory entities overflow`, sortFields: ["name", "score", "words", "links"]}),
                    formatOverflow(elem.key + "|directory entities overflow", entities, true)
                ],
                open: false
            }),
            { t: "h2", text: "Internals" },
            collapsible({
                key: elem.key + "|directory systems collapsible",
                header: { text: "Show all internal entities..." },
                children: [formatOverflow(elem.key + "|directory systems overflow", systems)],
                open: false
            }),
        ] };
}
exports.directory = directory;
exports.masonry = masonry_1.masonry;

},{"./app":9,"./masonry":11,"./ui":16,"./utils":19}],19:[function(require,module,exports){
var uuid_1 = require("../vendor/uuid");
exports.uuid = uuid_1.v4;
exports.ENV = "browser";
try {
    window;
    window["utils"] = exports;
}
catch (err) {
    exports.ENV = "node";
}
exports.DEBUG = {};
if (exports.ENV === "browser")
    window["DEBUG"] = exports.DEBUG;
function builtinId(name) {
    return "AUTOGENERATED " + name + " THIS SHOULDN'T SHOW UP ANYWHERE";
}
exports.builtinId = builtinId;
exports.unpad = function (indent) {
    if (exports.unpad.memo[indent])
        return exports.unpad.memo[indent];
    return exports.unpad.memo[indent] = function (strings) {
        var values = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            values[_i - 1] = arguments[_i];
        }
        if (!strings.length)
            return;
        var res = "";
        var ix = 0;
        for (var _a = 0; _a < strings.length; _a++) {
            var str = strings[_a];
            res += str + (values.length > ix ? values[ix++] : "");
        }
        if (res[0] === "\n")
            res = res.slice(1);
        var charIx = 0;
        while (true) {
            res = res.slice(0, charIx) + res.slice(charIx + indent);
            charIx = res.indexOf("\n", charIx) + 1;
            if (!charIx)
                break;
        }
        return res;
    };
};
exports.unpad.memo = {};
function repeat(str, length) {
    var len = length / str.length;
    var res = "";
    for (var ix = 0; ix < len; ix++)
        res += str;
    return (res.length > length) ? res.slice(0, length) : res;
}
exports.repeat = repeat;
function underline(startIx, length) {
    return repeat(" ", startIx) + "^" + repeat("~", length - 1);
}
exports.underline = underline;
function capitalize(word) {
    return word[0].toUpperCase() + word.slice(1);
}
exports.capitalize = capitalize;
function titlecase(name) {
    return name.split(" ").map(capitalize).join(" ");
}
exports.titlecase = titlecase;
var _slugifyReplacements = {
    "-": "dash",
    "_": "under",
    "$": "dollar",
    "&": "and",
    "+": "plus",
    ",": "comma",
    "/": "slash",
    ":": "colon",
    ";": "semicolon",
    "=": "equals",
    "?": "question",
    "@": "at",
    "<": "lt",
    ">": "gt",
    "#": "hash",
    "%": "percent",
    "{": "opencurly",
    "}": "closecurly",
    "|": "pipe",
    "\\": "whack",
    "^": "caret",
    "~": "tilde",
    "[": "openbracket",
    "]": "closebracket",
    "`": "grave"
};
var _deslugifyReplacements = {};
for (var char in _slugifyReplacements) {
    _deslugifyReplacements[_slugifyReplacements[char]] = char;
}
// Slugify encodes a uri component in a fairly human readable fashion
function slugify(text) {
    var url = "";
    for (var _i = 0; _i < text.length; _i++) {
        var char = text[_i];
        var replacement = _slugifyReplacements[char];
        if (char === " ") {
            url += "_";
        }
        else if (replacement) {
            url += "-'" + replacement + "-";
        }
        else {
            url += char;
        }
    }
    return encodeURIComponent(url);
}
exports.slugify = slugify;
function deslugify(url) {
    var text = [];
    for (var _i = 0, _a = url.split("_"); _i < _a.length; _i++) {
        var word = _a[_i];
        if (word.indexOf("-") === -1) {
            text.push(word);
            continue;
        }
        var replaced = "";
        var tokens = word.split("-");
        replaced += tokens.shift();
        var tail_1 = tokens.pop();
        for (var _b = 0; _b < tokens.length; _b++) {
            var token = tokens[_b];
            var replacement = _deslugifyReplacements[token.slice(1)];
            if (replacement && token.indexOf("'") === 0) {
                replaced += replacement;
            }
            else {
                replaced += token;
            }
        }
        replaced += tail_1;
        text.push(replaced);
    }
    return decodeURIComponent(text.join(" "));
}
exports.deslugify = deslugify;
exports.string = {
    unpad: exports.unpad,
    repeat: repeat,
    underline: underline,
    capitalize: capitalize,
    titlecase: titlecase,
    slugify: slugify,
    deslugify: deslugify
};
function tail(arr) {
    return arr[arr.length - 1];
}
exports.tail = tail;
exports.array = {
    tail: tail
};
function coerceInput(input) {
    // http://jsperf.com/regex-vs-plus-coercion
    if (typeof input === "object")
        return input;
    else if (!isNaN(+input))
        return +input;
    else if (input === "true")
        return true;
    else if (input === "false")
        return false;
    return input;
}
exports.coerceInput = coerceInput;
// Shallow copy the given object.
function copy(obj) {
    if (!obj || typeof obj !== "object")
        return obj;
    if (obj instanceof Array)
        return obj.slice();
    var res = {};
    for (var key in obj)
        res[key] = obj[key];
    return res;
}
exports.copy = copy;
function mergeObject(root, obj) {
    for (var key in obj) {
        root[key] = obj[key];
    }
    return root;
}
exports.mergeObject = mergeObject;
function autoFocus(node, elem) {
    if (!node.focused) {
        node.focused = true;
        node.focus();
    }
}
exports.autoFocus = autoFocus;
exports.KEYS = {
    ESC: 27,
    ENTER: 13,
    UP: 38,
    DOWN: 40,
    BACKSPACE: 8,
    "]": 221,
};
// FROM: http://stackoverflow.com/questions/1125292/how-to-move-cursor-to-end-of-contenteditable-entity/3866442#3866442
function setEndOfContentEditable(contentEditableElement) {
    var range, selection;
    if (document.createRange) {
        range = document.createRange(); //Create a range (a range is a like the selection but invisible)
        range.selectNodeContents(contentEditableElement); //Select the entire contents of the element with the range
        range.collapse(false); //collapse the range to the end point. false means collapse to end rather than the start
        selection = window.getSelection(); //get the selection object (allows you to change selection)
        selection.removeAllRanges(); //remove any selections already made
        selection.addRange(range); //make the range you have just created the visible selection
    }
}
exports.setEndOfContentEditable = setEndOfContentEditable;
// LCG courtesy of <https://gist.github.com/Protonk/5389384>
function srand(z) {
    var m = Math.pow(2, 24), a = 16598013, c = 12820163;
    return function () { return z = (a * z + c) % m / m; };
}
exports.srand = srand;
// Shuffle courtesy of <http://stackoverflow.com/a/6274381>
function shuffle(o, rand) {
    if (rand === void 0) { rand = Math.random; }
    for (var j, x, i = o.length; i; j = Math.floor(rand() * i), x = o[--i], o[i] = o[j], o[j] = x)
        ;
    return o;
}
exports.shuffle = shuffle;
function sortByField(field, direction) {
    if (direction === void 0) { direction = 1; }
    var back = -1 * direction;
    var fwd = direction;
    return function (a, b) {
        return (a[field] === b[field]) ? 0 :
            (a[field] > b[field]) ? back :
                (a[field] < b[field]) ? fwd :
                    (a[field] === undefined) ? fwd : back;
    };
}
exports.sortByField = sortByField;
function sortByLookup(lookup, direction) {
    if (direction === void 0) { direction = 1; }
    var back = -1 * direction;
    var fwd = direction;
    return function (a, b) {
        return (lookup[a] === lookup[b]) ? 0 :
            (lookup[a] > lookup[b]) ? back :
                (lookup[a] < lookup[b]) ? fwd :
                    (lookup[a] === undefined) ? fwd : back;
    };
}
exports.sortByLookup = sortByLookup;
function location() {
    return window.location.hash.slice(1);
}
exports.location = location;

},{"../vendor/uuid":22}],20:[function(require,module,exports){
"use strict";
var app = require("./app");
var bootstrap = require("./bootstrap");
var ui = require("./ui");
var utils_1 = require("./utils");
app.renderRoots["wiki"] = ui.root;
// @HACK: we have to use bootstrap in some way to get it to actually be included and
// executed
var ixer = bootstrap.ixer;
function initSearches(eve) {
    for (var _i = 0, _a = eve.find("ui pane"); _i < _a.length; _i++) {
        var pane = _a[_i];
        if (eve.findOne("entity", { entity: pane.contains }))
            continue;
    }
}
app.init("wiki", function () {
    document.body.classList.add(localStorage["theme"] || "light");
    app.activeSearches = {};
    initSearches(app.eve);
    window.history.replaceState({ root: true }, null, window.location.hash);
    var mainPane = app.eve.findOne("ui pane", { pane: "p1" });
    var path = utils_1.location();
    var _a = path.split("/"), _ = _a[0], kind = _a[1], _b = _a[2], raw = _b === void 0 ? "" : _b;
    var content = utils_1.deslugify(raw) || "home";
    var cur = app.dispatch("set pane", { paneId: mainPane.pane, contains: content });
    if (content && !app.eve.findOne("query to id", { query: content })) {
        cur.dispatch("insert query", { query: content });
    }
    cur.commit();
});
window.addEventListener("hashchange", function () {
    var mainPane = app.eve.findOne("ui pane", { pane: "p1" });
    var path = utils_1.location();
    var _a = path.split("/"), _ = _a[0], kind = _a[1], _b = _a[2], raw = _b === void 0 ? "" : _b;
    var content = utils_1.deslugify(raw) || "home";
    content = ui.asEntity(content) || content;
    if (mainPane.contains === content)
        return;
    var cur = app.dispatch("set pane", { paneId: mainPane.pane, contains: content });
    if (content && !app.eve.findOne("query to id", { query: content })) {
        cur.dispatch("insert query", { query: content });
    }
    cur.commit();
});

},{"./app":9,"./bootstrap":10,"./ui":16,"./utils":19}],21:[function(require,module,exports){

},{}],22:[function(require,module,exports){
//     uuid.js
//
//     Copyright (c) 2010-2012 Robert Kieffer
//     MIT License - http://opensource.org/licenses/mit-license.php

(function() {
  var _global = this;

  // Unique ID creation requires a high quality random # generator.  We feature
  // detect to determine the best RNG source, normalizing to a function that
  // returns 128-bits of randomness, since that's what's usually required
  var _rng;

  // Node.js crypto-based RNG - http://nodejs.org/docs/v0.6.2/api/crypto.html
  //
  // Moderately fast, high quality
  if (typeof(_global.require) == 'function') {
    try {
      var _rb = _global.require('crypto').randomBytes;
      _rng = _rb && function() {return _rb(16);};
    } catch(e) {}
  }

  if (!_rng && _global.crypto && crypto.getRandomValues) {
    // WHATWG crypto-based RNG - http://wiki.whatwg.org/wiki/Crypto
    //
    // Moderately fast, high quality
    var _rnds8 = new Uint8Array(16);
    _rng = function whatwgRNG() {
      crypto.getRandomValues(_rnds8);
      return _rnds8;
    };
  }

  if (!_rng) {
    // Math.random()-based (RNG)
    //
    // If all else fails, use Math.random().  It's fast, but is of unspecified
    // quality.
    var  _rnds = new Array(16);
    _rng = function() {
      for (var i = 0, r; i < 16; i++) {
        if ((i & 0x03) === 0) r = Math.random() * 0x100000000;
        _rnds[i] = r >>> ((i & 0x03) << 3) & 0xff;
      }

      return _rnds;
    };
  }

  // Buffer class to use
  var BufferClass = typeof(_global.Buffer) == 'function' ? _global.Buffer : Array;

  // Maps for number <-> hex string conversion
  var _byteToHex = [];
  var _hexToByte = {};
  for (var i = 0; i < 256; i++) {
    _byteToHex[i] = (i + 0x100).toString(16).substr(1);
    _hexToByte[_byteToHex[i]] = i;
  }

  // **`parse()` - Parse a UUID into it's component bytes**
  function parse(s, buf, offset) {
    var i = (buf && offset) || 0, ii = 0;

    buf = buf || [];
    s.toLowerCase().replace(/[0-9a-f]{2}/g, function(oct) {
      if (ii < 16) { // Don't overflow!
        buf[i + ii++] = _hexToByte[oct];
      }
    });

    // Zero out remaining bytes if string was short
    while (ii < 16) {
      buf[i + ii++] = 0;
    }

    return buf;
  }

  // **`unparse()` - Convert UUID byte array (ala parse()) into a string**
  function unparse(buf, offset) {
    var i = offset || 0, bth = _byteToHex;
    return  bth[buf[i++]] + bth[buf[i++]] +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] +
            bth[buf[i++]] + bth[buf[i++]] +
            bth[buf[i++]] + bth[buf[i++]];
  }

  // **`v1()` - Generate time-based UUID**
  //
  // Inspired by https://github.com/LiosK/UUID.js
  // and http://docs.python.org/library/uuid.html

  // random #'s we need to init node and clockseq
  var _seedBytes = _rng();

  // Per 4.5, create and 48-bit node id, (47 random bits + multicast bit = 1)
  var _nodeId = [
    _seedBytes[0] | 0x01,
    _seedBytes[1], _seedBytes[2], _seedBytes[3], _seedBytes[4], _seedBytes[5]
  ];

  // Per 4.2.2, randomize (14 bit) clockseq
  var _clockseq = (_seedBytes[6] << 8 | _seedBytes[7]) & 0x3fff;

  // Previous uuid creation time
  var _lastMSecs = 0, _lastNSecs = 0;

  // See https://github.com/broofa/node-uuid for API details
  function v1(options, buf, offset) {
    var i = buf && offset || 0;
    var b = buf || [];

    options = options || {};

    var clockseq = options.clockseq != null ? options.clockseq : _clockseq;

    // UUID timestamps are 100 nano-second units since the Gregorian epoch,
    // (1582-10-15 00:00).  JSNumbers aren't precise enough for this, so
    // time is handled internally as 'msecs' (integer milliseconds) and 'nsecs'
    // (100-nanoseconds offset from msecs) since unix epoch, 1970-01-01 00:00.
    var msecs = options.msecs != null ? options.msecs : new Date().getTime();

    // Per 4.2.1.2, use count of uuid's generated during the current clock
    // cycle to simulate higher resolution clock
    var nsecs = options.nsecs != null ? options.nsecs : _lastNSecs + 1;

    // Time since last uuid creation (in msecs)
    var dt = (msecs - _lastMSecs) + (nsecs - _lastNSecs)/10000;

    // Per 4.2.1.2, Bump clockseq on clock regression
    if (dt < 0 && options.clockseq == null) {
      clockseq = clockseq + 1 & 0x3fff;
    }

    // Reset nsecs if clock regresses (new clockseq) or we've moved onto a new
    // time interval
    if ((dt < 0 || msecs > _lastMSecs) && options.nsecs == null) {
      nsecs = 0;
    }

    // Per 4.2.1.2 Throw error if too many uuids are requested
    if (nsecs >= 10000) {
      throw new Error('uuid.v1(): Can\'t create more than 10M uuids/sec');
    }

    _lastMSecs = msecs;
    _lastNSecs = nsecs;
    _clockseq = clockseq;

    // Per 4.1.4 - Convert from unix epoch to Gregorian epoch
    msecs += 12219292800000;

    // `time_low`
    var tl = ((msecs & 0xfffffff) * 10000 + nsecs) % 0x100000000;
    b[i++] = tl >>> 24 & 0xff;
    b[i++] = tl >>> 16 & 0xff;
    b[i++] = tl >>> 8 & 0xff;
    b[i++] = tl & 0xff;

    // `time_mid`
    var tmh = (msecs / 0x100000000 * 10000) & 0xfffffff;
    b[i++] = tmh >>> 8 & 0xff;
    b[i++] = tmh & 0xff;

    // `time_high_and_version`
    b[i++] = tmh >>> 24 & 0xf | 0x10; // include version
    b[i++] = tmh >>> 16 & 0xff;

    // `clock_seq_hi_and_reserved` (Per 4.2.2 - include variant)
    b[i++] = clockseq >>> 8 | 0x80;

    // `clock_seq_low`
    b[i++] = clockseq & 0xff;

    // `node`
    var node = options.node || _nodeId;
    for (var n = 0; n < 6; n++) {
      b[i + n] = node[n];
    }

    return buf ? buf : unparse(b);
  }

  // **`v4()` - Generate random UUID**

  // See https://github.com/broofa/node-uuid for API details
  function v4(options, buf, offset) {
    // Deprecated - 'format' argument, as supported in v1.2
    var i = buf && offset || 0;

    if (typeof(options) == 'string') {
      buf = options == 'binary' ? new BufferClass(16) : null;
      options = null;
    }
    options = options || {};

    var rnds = options.random || (options.rng || _rng)();

    // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`
    rnds[6] = (rnds[6] & 0x0f) | 0x40;
    rnds[8] = (rnds[8] & 0x3f) | 0x80;

    // Copy bytes to buffer, if provided
    if (buf) {
      for (var ii = 0; ii < 16; ii++) {
        buf[i + ii] = rnds[ii];
      }
    }

    return buf || unparse(rnds);
  }

  // Export public API
  var uuid = v4;
  uuid.v1 = v1;
  uuid.v4 = v4;
  uuid.parse = parse;
  uuid.unparse = unparse;
  uuid.BufferClass = BufferClass;

  if (typeof define === 'function' && define.amd) {
    // Publish as AMD module
    define(function() {return uuid;});
  } else if (typeof(module) != 'undefined' && module.exports) {
    // Publish as node.js module
    module.exports = uuid;
  } else {
    // Publish as global (in browsers)
    var _previousRoot = _global.uuid;

    // **`noConflict()` - (browser only) to reset global 'uuid' var**
    uuid.noConflict = function() {
      _global.uuid = _previousRoot;
      return uuid;
    };

    _global.uuid = uuid;
  }
}).call(this);

},{}]},{},[20,21])