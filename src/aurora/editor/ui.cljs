(ns aurora.editor.ui
  (:require [aurora.compiler.compiler :as compiler]
            [aurora.editor.dom :as dom]
            [aurora.editor.core :as core :refer [aurora-state]]
            [aurora.compiler.code :as code]
            [aurora.editor.running :as run]
            [aurora.editor.nodes :as nodes]
            [aurora.compiler.datalog :as datalog]
            [clojure.string :as string]
            [clojure.set :as set]
            [cljs.reader :as reader]
            [aurora.util.core :as util :refer [now]]
            [aurora.editor.cursors :as cursors :refer [cursor cursors]])
  (:require-macros [aurora.macros :refer [defdom dom mapv-indexed]]
                   [aurora.compiler.datalog :refer [rule q1 q+ q* q?]]))

;;*********************************************************
;; utils
;;*********************************************************

;(js/React.initializeTouchEvents true)

(extend-type function
  Fn
  IMeta
  (-meta [this] (.-meta this)))

(alter-meta! number? assoc :desc "Is |1| a number? " :name "cljs.core.number_QMARK_")
(alter-meta! mapv assoc
             :desc-template "With each of |2| |1|"
             :desc "With each of this do.."
             :name "cljs.core.mapv")

;;*********************************************************
;; graph
;;*********************************************************

(defdom steps-ui [stack]
  [:div {:className "steps"}
   "Hey"
   ])

;;*********************************************************
;; nav
;;*********************************************************

(defn all-groups [xs]
  (for [i (range (count xs))]
    (take (inc i) xs)))

(defdom nav []
  [:div {:id "nav"}
   [:ul {:className "breadcrumb"}
    (each [stack (all-groups (reverse (:stack @aurora-state)))]
          (let [[type id] (last stack)
                cur (cursor id)]
            (when (and cur (not= type :step))
              [:li {:onClick (fn []
                               (set-stack! (drop-while #(= (first %) :step)
                                                       (reverse (butlast stack)))))}
               (or (:desc @cur) (:id @cur))])))]
   ])

;;*********************************************************
;; Notebooks
;;*********************************************************

(defn click-add-notebook [e]
  (add-notebook! "untitled notebook"))

(defdom notebooks-list [aurora]
  [:ul {:className "notebooks"}
   (each [notebook (cursors (:notebooks aurora))]
         (let [click (fn []
                       (swap! aurora-state assoc :notebook (:id @notebook) :screen :pages
                              :stack (list [:notebook (:id @notebook)])))]
           (if (input? (:id @notebook))
             [:li {:className "notebook"}
              [:input {:type "text" :defaultValue (:desc @notebook)
                       :onKeyPress (fn [e]
                                     (when (= 13 (.-charCode e))
                                       (remove-input! (:id @notebook))
                                       (swap! notebook assoc :desc (.-target.value e))
                                       ))}]]
             [:li {:className "notebook"
                   :onContextMenu #(show-menu! % [{:label "Rename"
                                                   :action (fn []
                                                             (add-input! (:id @notebook) :desc)
                                                             )}
                                                  {:label "Remove"
                                                   :action (fn []
                                                             (remove-notebook! notebook))}])
                   :onClick click}
              (:desc @notebook)])))
   [:li {:className "add-notebook"
         :onClick click-add-notebook} "+"]])

;;*********************************************************
;; Pages
;;*********************************************************

(defn click-add-page [e notebook]
  (add-page! notebook "untitled page" {:args ["root"]}))

(defdom pages-list [notebook]
  [:ul {:className "notebooks"}
   (each [page (filter #(get (:tags @%) :page) (cursors (:pages @notebook)))]
         (let [click (fn []
                       (swap! aurora-state assoc
                              :page (:id @page)
                              :editor-zoom :graph
                              :stack (-> ()
                                         (push notebook)
                                         (push page)
                                         )))]
           (if (input? (:id @page))
             [:li {:className "notebook"}
              [:input {:type "text" :defaultValue (:desc @page)
                       :onKeyPress (fn [e]
                                     (when (= 13 (.-charCode e))
                                       (remove-input! (:id @page))
                                       (swap! page assoc :desc (.-target.value e))))}]]
             [:li {:className "notebook"
                   :onContextMenu (fn [e]
                                    (show-menu! e [{:label "Rename"
                                                                    :action (fn []
                                                                              (add-input! (:id @page) :desc)
                                                                              )}
                                                                   {:label "Remove"
                                                                    :action (fn []
                                                                              (remove-page! notebook page))}]))
                   :onClick click}
              (:desc @page)])))
   [:li {:className "add-notebook"
         :onClick #(click-add-page % notebook)} "+"]])

;;*********************************************************
;; Aurora ui
;;*********************************************************

(defdom aurora-ui [stack]
  [:div
   (when (util/nw?)
     [:div {:className "debug"}
      [:button {:onClick (fn []
                           (.reload js/window.location 0))}  "R"]
      [:button {:onClick (fn []
                           (.. (js/require "nw.gui") (Window.get) (showDevTools)))}  "D"]])
   (nav)
   [:div {:id "content"}
    (steps-ui stack)

    ]])


;;*********************************************************
;; Rules
;;*********************************************************

(def r-screen (rule [:app :app/stack ?stack]
                    (:collect ?page [[?id :page true]
                                     (:in ?id stack)
                                     :return
                                     id])
                    (:collect ?notebooks [[?idn :notebook true]
                                          (:in ?idn stack)
                                         :return
                                         idn])
                    :return
                    [:app :app/screen
                     (cond
                      (seq page) :steps
                      (seq notebooks) :pages
                      :else :notebooks)]))

(def r-notebook-item (rule [?id :notebook true]
                           [?id :description ?desc]
                           :return
                           [id :ui/notebook-item (notebook-item (cursor [id :notebook/description ?desc]))]))

(def r-notebooks (rule [?id :notebook true]
                       [?id :description ?desc]
                       :return
                       [id :ui/notebook-item (notebook-item (cursor [id :notebook/description ?desc]))]))

;;*********************************************************
;; Re-rendering
;;*********************************************************

(defn focus! []
  (when-let [cur (last (dom/$$ :.focused))]
    (.focus cur)))

(def queued? false)
(def RAF js/requestAnimationFrame)

(defn update []
  (let [start (now)
        knowledge @aurora-state]
    (js/React.renderComponent
     (aurora-ui knowledge)
     (js/document.getElementById "wrapper"))
    (focus!)
    (set! (.-innerHTML (js/document.getElementById "render-perf")) (- (now) start))
    (set! queued? false)))

(defn queue-render []
  (when-not queued?
    (set! queued? true)
    (RAF update)))

(add-watch aurora-state :foo (fn [_ _ _ cur]
                               (queue-render)))

;;*********************************************************
;; Go!
;;*********************************************************

(core/repopulate)
(swap! aurora-state datalog/dangerously-learn-rules [[r-screen]])
