(ns aurora.editor.core
  (:require [aurora.compiler.compiler :as compiler]
            [aurora.compiler.code :as code]
            [aurora.compiler.datalog :as datalog]
            [aurora.compiler.schema :as schema]
            [cljs.reader :as reader]
            [clojure.set :as set])
  (:require-macros [aurora.compiler.datalog :refer [rule q1 q+ q* q?]]))

(enable-console-print!)

(def r-persistent (schema/group :persistent :notebook :page :step? :step :ref))

;;*********************************************************
;; Aurora state
;;*********************************************************

(def default-state (datalog/knowledge #{[:app :app/stack []]} (concat code/rules [[r-persistent]])))
(def aurora-state (atom default-state))

;;*********************************************************
;; Aurora state (storage!)
;;*********************************************************

(defn freeze [state]
  (-> (q* state
          [?id :persistent true]
          [?id ?key ?value]
          (not= key :persistent)
          (= (.indexOf (str key) "ui/") -1)
          :return
          [id key value])
      (pr-str)))

(defn store! [state]
  (aset js/localStorage "aurora-state" (freeze state)))

(defn thaw [state]
  (let [state (if (string? state)
                (reader/read-string state)
                state)]
    (datalog/knowledge
     (set/union state code/stdlib #{[:app :app/stack []]})
     (concat code/rules [[r-persistent]
                         [js/aurora.editor.ui.r-screen]
                         [js/aurora.editor.ui.r-nav-items]
                         [js/aurora.editor.ui.r-nav-page
                          js/aurora.editor.ui.r-nav-notebook]
                         js/aurora.editor.ui.data-rules
                         ]))))

(defn repopulate []
  (let [stored (aget js/localStorage "aurora-state")]
    (if (and stored
             (not= "{}" stored)
             (not= "#{}" stored)
             (not= "null" stored)
             (not= stored ""))
      (reset! aurora-state (thaw stored))
      (reset! aurora-state default-state))))

(defn clear-storage! []
  (aset js/localStorage "aurora-state" nil))

(add-watch aurora-state :storage (js/Cowboy.debounce 1000
                                                     (fn [_ _ _ cur]
                                                      (store! cur))))
