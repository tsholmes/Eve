(ns aurora.editor.cursors
  (:require [aurora.editor.core :refer [aurora-state]]
            [aurora.compiler.datalog :as datalog :refer [batch]]))

;;*********************************************************
;; Cursors
;;
;; Cursors are sub-atoms relative to some ID that allows
;; us to easily manipulate a node in the index
;;*********************************************************

(defprotocol ICursor)

(defn mutable? [cursor]
  (not (aget cursor "locked")))

(deftype KnowledgeCursor [knowledge entity attr value]
  ICursor

  IReset
  (-reset! [o new-value]
           (swap! knowledge batch #{[entity attr new-value]} #{[entity attr (.-value o)]})
           (set! (.-value o) new-value))

  ILookup
  (-lookup [o k]
           (cursor entity k))

  ISwap
  (-swap! [o f]
          (-reset! o (f value)))
  (-swap! [o f a]
          (-reset! o (f value a)))
  (-swap! [o f a b]
          (-reset! o (f value a b)))
  (-swap! [o f a b xs]
          (-reset! o (apply f value a b xs)))


  IEquiv
  (-equiv [o other] (identical? o other))

  IDeref
  (-deref [this] (.-value this))

  IPrintWithWriter
  (-pr-writer [this writer opts]
    (-write writer (str "#<Cursor: " (pr-str [entity attr value]) ">")))

  IHash
  (-hash [this] (goog.getUid this)))


(defn cursor! [entity attr value]
  (let [cur (datalog/has @aurora-state entity attr)]
    (KnowledgeCursor. aurora-state entity attr (first cur))))

(defn cursor [entity attr]
  (let [cur (datalog/has @aurora-state entity attr)]
    (when cur
      (KnowledgeCursor. aurora-state entity attr (first cur)))))

(defn cursors [ids attr]
  (filter identity (map #(cursor % attr) ids)))

