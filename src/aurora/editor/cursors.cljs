(ns aurora.editor.cursors
  (:require [aurora.editor.core :refer [aurora-state]]
            [aurora.compiler.datalog :refer [batch]]))

;;*********************************************************
;; Cursors
;;
;; Cursors are sub-atoms relative to some ID that allows
;; us to easily manipulate a node in the index
;;*********************************************************

(defprotocol ICursor)

(defn mutable? [cursor]
  (not (aget cursor "locked")))

(deftype KnowledgeCursor [knowledge cur]
  ICursor

  IReset
  (-reset! [o new-value]
           (swap! knowledge batch new-value cur))

  ISwap
  (-swap! [o f]
          (-reset knowledge [(first cur) (second cur) (f (last cur))]))
  (-swap! [o f a]
          (-reset knowledge [(first cur) (second cur) (f (last cur) a)]))
  (-swap! [o f a b]
          (-reset knowledge [(first cur) (second cur) (f (last cur) a b)]))
  (-swap! [o f a b xs]
          (-reset knowledge [(first cur) (second cur) (apply f (last cur) a b xs)]))


  IEquiv
  (-equiv [o other] (identical? o other))

  IDeref
  (-deref [this] (last cur))

  IPrintWithWriter
  (-pr-writer [this writer opts]
    (-write writer (str "#<Cursor: " (pr-str cur) ">")))

  IHash
  (-hash [this] (goog.getUid this)))

(defn cursor [cur]
  (KnowledgeCursor. aurora-state cur))

(defn cursors [ids]
  (map cursor ids))
