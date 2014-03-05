(ns aurora.editor.core
  (:require [aurora.compiler.compiler :as compiler]
            [aurora.compiler.code :as code]
            [cljs.reader :as reader]
            [clojure.set :as set]))

(enable-console-print!)

;;*********************************************************
;; Aurora state
;;*********************************************************

(def aurora-state (atom nil))
(def default-state #{[:app :app/stack '()]})

;;*********************************************************
;; Aurora state (storage!)
;;*********************************************************


(defn freeze [state]
  (-> state
      (pr-str)))

(defn store! [state]
  (aset js/localStorage "aurora-state" (freeze state)))

(defn thaw [state]
  (let [state (if (string? state)
                (reader/read-string state)
                state)]
    (set/union state code/stdlib)))

(defn repopulate []
  (let [stored (aget js/localStorage "aurora-state")]
    (if (and stored
             (not= "{}" stored)
             (not= "null" stored)
             (not= stored ""))
      (reset! aurora-state (thaw stored))
      (reset! aurora-state (thaw default-state)))))

(defn clear-storage! []
  (aset js/localStorage "aurora-state" nil))

(add-watch aurora-state :storage (js/Cowboy.debounce 1000
                                                     (fn [_ _ _ cur]
                                                      (store! cur))))
