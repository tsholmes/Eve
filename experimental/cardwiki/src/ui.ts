import {parse as marked, Renderer as MarkedRenderer} from "../vendor/marked";
/// <reference path="codemirror/codemirror.d.ts" />
import * as CodeMirror from "codemirror";
import {Element, Handler, RenderHandler} from "./microReact";
import {eve} from "./app";

enum PANE { WINDOW, POPOUT, FULL };
enum BLOCK { TEXT, PROJECTION };

//---------------------------------------------------------
// Utils
//---------------------------------------------------------
var markedEntityRenderer = new MarkedRenderer();
markedEntityRenderer.heading = function(text:string, level: number) {
  return `<h${level}>${text}</h${level}>`; // override auto-setting an id based on content.
};
function entityToHTML(paneId:string, content:string, passthrough?: string[]):string {
  let md = marked(content, {breaks: true, renderer: markedEntityRenderer});
  let ix = md.indexOf("{");
  let queryCount = 0;
  let stack = [];
  while(ix !== -1) {
    if(md[ix - 1] === "\\") {
      md = md.slice(0, ix - 1) + md.slice(ix);
      ix--;

    } else if(md[ix] === "{") stack.push(ix);
    else if(md[ix] === "}") {
      let startIx = stack.pop();
      let content = md.slice(startIx + 1, ix);
      let colonIx = content.indexOf(":");

      let value = (colonIx !== -1 ? content.slice(colonIx + 1) : content).trim();
      let replacement;
      let type = "attribute";
      if(passthrough && passthrough.indexOf(value) !== -1) type = "passthrough";
      else if(eve.findOne("collection", {collection: value.toLowerCase()})) type = "collection";
      else if(eve.findOne("entity", {entity: value.toLowerCase()})) type = "entity";
      else if(colonIx === -1) type = "query";

      if(type === "attribute") {
        let attr = content.slice(0, colonIx).trim();
        replacement = `<span class="attribute" data-attribute="${attr}">${value}</span>`;

      } else if(type === "entity") {
        let attr = content.slice(0, colonIx !== -1 ? colonIx : undefined).trim();
        let onClick = `app.dispatch('setSearch', {value: '${value}', searchId: '${paneId}'}).commit();`;
        replacement = `<a class="link attribute entity" data-attribute="${attr}" onclick="${onClick}">${value}</a>`;

      } else if(type === "collection") {
        let attr = content.slice(0, colonIx !== -1 ? colonIx : undefined).trim();
        let onClick = `app.dispatch('setSearch', {value: '${value}', searchId: '${paneId}'}).commit();`;
        replacement = `<a class="link attribute collection" data-attribute="${attr}" onclick="${onClick}">${value}</a>`;

      } else if(type === "query") {
        let containerId = `${paneId}|${content}|${queryCount++}`;
        replacement = `<span class="embedded-query search-results" id="${containerId}" data-embedded-search="${content}"></span>`;
      }

      if(type !== "passthrough") {
        md = md.slice(0, startIx) + replacement + md.slice(ix + 1);
        ix += replacement.length - content.length - 2;
      }

    } else {
      throw new Error(`Unexpected character '${md[ix]}' at index ${ix}`);
    }

    // @NOTE: There has got to be a more elegant solution for (min if > 0) here.
    let nextCloseIx = md.indexOf("}", ix + 1);
    let nextOpenIx = md.indexOf("{", ix + 1);
    if(nextCloseIx === -1) ix = nextOpenIx;
    else if(nextOpenIx === -1) ix = nextCloseIx;
    else if(nextCloseIx < nextOpenIx) ix = nextCloseIx;
    else ix = nextOpenIx;
  }

  return md;
}

//---------------------------------------------------------
// Wiki Containers
//---------------------------------------------------------
export function root():Element {
  let panes = [];
  for(let {pane:paneId} of eve.find("ui pane")) {
    panes.push(pane(paneId));
  }
  return {c: "wiki-root test", children: panes};
}

// @TODO: Add search functionality + Pane Chrome
let paneChrome:{[kind:number]: (paneId:string, entityId:string) => {c?: string, header?:Element, footer?:Element}} = {
  [PANE.FULL]: (paneId) => ({
    c: "fullscreen",
    header: {t: "header", c: "flex-row", children: [{c: "logo eve-logo"}, search(paneId)]}
  }),
  [PANE.POPOUT]: (paneId, entityId) => ({
    header: {t: "header", c: "flex-row", children: [
      {c: "flex-grow title", text: entityId},
      {c: "flex-row controls", children: [{c: "ion-close-round"}]}
    ]}
  }),
  [PANE.WINDOW]: (paneId, entityId) => ({
    header: {t: "header", c: "flex-row", children: [
      {c: "flex-grow title", text: entityId},
      {c: "flex-row controls", children: [
        {c: "ion-android-search"},
        {c: "ion-minus-round"},
        {c: "ion-close-round"}
      ]}
    ]}
  })
};

export function pane(paneId:string):Element {
  // @FIXME: Add kind to ui panes
  let {contains:entityId = undefined, kind = PANE.FULL} = eve.findOne("ui pane", {pane: paneId}) || {};
  let makeChrome = paneChrome[kind];
  if(!makeChrome) throw new Error(`Unknown pane kind: '${kind}' (${PANE[kind]})`);
  let {c:klass, header, footer} = makeChrome(paneId, entityId);
  return {c: `wiki-pane ${klass || ""}`, children: [
    header,
    entity(entityId, paneId),
    footer
  ]};
}

export function entity(entityId:string, paneId:string):Element {
  // @TODO: This is where the new editor gets injected
  let blocks = [];
  for(let {block:blockId} of eve.find("content blocks", {entity: entityId})) blocks.push(block(blockId, paneId));
  return {c: "wiki-entity", children: blocks};
}

export function block(blockId:string, paneId:string):Element {
  // @FIXME: Add kind to content blocks
  let {content = "", kind = BLOCK.TEXT} = eve.findOne("content blocks", {block: blockId}) || {};
  let html = "";
  if(kind === BLOCK.TEXT) {
    html = entityToHTML(paneId, content);
  } else throw new Error(`Unknown block kind: '${kind}' (${BLOCK[kind]})`);

  return {c: "wiki-block", dangerouslySetInnerHTML: html};
}

//---------------------------------------------------------
// Wiki Widgets
//---------------------------------------------------------
export function search(paneId:string):Element {
  return {
    c: "flex-grow wiki-search",
    children: [
      codeMirrorElement({
        c: "flex-grow search-box",
        paneId,
        placeholder: "search...",
        blur: setSearch,
        change: updateSearch,
        shortcuts: {"Enter": setSearch}
      }),
      //{c: `ion-ios-arrow-${showPlan ? 'up' : 'down'} plan`, click: toggleShowPlan, searchId},
      {c: "controls", children: [{c: "ion-android-search", paneId, click: setSearch}]},
    ]
  };
}

function setSearch(event, elem) {
  // @TODO: Implement me!
  console.log("set", event, elem);
}
function updateSearch(event, elem) {
  // @TODO: Implement me!
  console.log("update", event, elem);
}

//---------------------------------------------------------
// UITK
//---------------------------------------------------------
interface CMNode extends HTMLElement { cm: any }
interface CMElement extends Element {
  autofocus?: boolean
  lineNumbers?: boolean,
  lineWrapping?: boolean,
  mode?: string,
  shortcuts?: {[shortcut:string]: Handler<any>}
};
interface CMEvent extends Event {
  editor:CodeMirror.Editor
}
export function codeMirrorElement(elem:CMElement):CMElement {
  elem.postRender = codeMirrorPostRender(elem.postRender);
  return elem;
}

let _codeMirrorPostRenderMemo = {};
function handleCMEvent(handler:Handler<Event>, elem:CMElement):(cm:CodeMirror.Editor) => void {
  return (cm:CodeMirror.Editor) => {
    let evt = <CMEvent><any>(new CustomEvent("CMEvent"));
    evt.editor = cm;
    handler(evt, elem);
  }
}
function codeMirrorPostRender(postRender?:RenderHandler):RenderHandler {
  let key = postRender ? postRender.toString() : "";
  if(_codeMirrorPostRenderMemo[key]) return _codeMirrorPostRenderMemo[key];
  return _codeMirrorPostRenderMemo[key] = (node:CMNode, elem:CMElement) => {
    let cm = node.cm;
    if(!cm) {
      let extraKeys = {};
      if(elem.shortcuts) {
        for(let shortcut in elem.shortcuts)
          extraKeys[shortcut] = handleCMEvent(elem.shortcuts[shortcut], elem);
      }
      cm = node.cm = CodeMirror(node, {
        lineWrapping: elem.lineWrapping !== false ? true : false,
        lineNumbers: elem.lineNumbers,
        mode: elem.mode || "gfm",
        extraKeys
      });
      if(elem.change) cm.on("change", handleCMEvent(elem.change, elem));
      if(elem.blur) cm.on("blur", handleCMEvent(elem.blur, elem));
      if(elem.focus) cm.on("focus", handleCMEvent(elem.focus, elem));
      if(elem.autofocus) cm.focus();
    }

    if(cm.getValue() !== elem.value) cm.setValue(elem.value || "");
    if(postRender) postRender(node, elem);
  }
}

// @NOTE: Uncomment this to enable the new UI, or type `window["NEUE_UI"] = true; app.render()` into the console to enable it transiently.
// window["NEUE_UI"] = true;