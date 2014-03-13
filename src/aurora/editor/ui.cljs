(ns aurora.editor.ui
  (:require [aurora.compiler.compiler :as compiler]
            [aurora.editor.dom :as dom]
            [aurora.editor.core :as core :refer [aurora-state]]
            [aurora.compiler.code :as code]
            [aurora.compiler.schema :as schema]
            [aurora.editor.running :as run]
            [aurora.editor.nodes :as nodes]
            [aurora.editor.ReactDommy :refer [node]]
            [aurora.compiler.datalog :as datalog]
            [clojure.string :as string]
            [clojure.set :as set]
            [cljs.reader :as reader]
            [aurora.util.core :as util :refer [now]]
            [aurora.editor.cursors :as cursors :refer [cursor cursors cursor!]])
  (:require-macros [aurora.macros :refer [defdom dom mapv-indexed]]
                   [aurora.compiler.datalog :refer [rule q1 q+ q* q?]]))

;;*********************************************************
;; utils
;;*********************************************************

(defn ea-value [e a]
  (when-let [c (cursor e a)]
    @c))

;(js/React.initializeTouchEvents true)

(extend-type js/React.__internals.DOMComponent
  IHash
  (-hash [o] (hash (js/JSON.stringify o))))

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

(comment
  (core/repopulate)
  (click-add-step nil (ea-value :nav :nav/page))
  (schema/errors @aurora-state)
  (core/clear-storage!)
  (ea-value :app :app/stack)
  (ea-value :nav :nav/items)
  (ea-value :app :app/screen)
  (datalog/has @aurora-state :app))



(defn click-add-step [e page v]
  (let [pg (nodes/constant v)]
    (swap! aurora-state datalog/batch (set (:facts pg)) #{})
    (swap! (cursor page :page/steps) conj (:id pg))))

(defdom steps-ui [knowledge]
  (let [cur-page (ea-value :nav :nav/page)
        steps (q1 knowledge
                  [:nav :nav/page ?page]
                  [?page :page/steps ?steps]
                  :return
                  steps)
        _ (println steps)
        steps->ui (into {} (q* knowledge
                               [:nav :nav/page ?page]
                               [?id :step->page ?page]
                               [?id :ui/rep ?rep]
                               :return
                               [id rep]))]
    [:div {:id "steps-container"}

     [:ul  {:id "steps-list"}
      (each [s steps]
        [:li (node (steps->ui s))])
      [:li {:className "current"}
       [:span {:onClick (fn [e] (click-add-step e cur-page [3 4 5]))} "vec"]
       [:span {:onClick (fn [e] (click-add-step e cur-page {"foo" "bar"}))} "map"]
       [:span {:onClick (fn [e] (click-add-step e cur-page "woot"))} "string"]
       [:span {:onClick (fn [e] (click-add-step e cur-page 500))} "number"]]]
     [:ul {:id "registers"}
      [:li "box"]
      [:li "box2"]
      (comment
        [:li "box3"]
        [:li "box4"]
        [:li "box5"]
        [:li "box6"]
        [:li "box7"]
        [:li "box8"]
        [:li "box9"]
        [:li "box10"])
      ]
     ]))

;;*********************************************************
;; nav
;;*********************************************************

(defn all-groups [xs]
  (for [i (range (count xs))]
    (take (inc i) xs)))

(defdom nav []
  (let [nav-items (ea-value :nav :nav/items)
        items (when nav-items
                (filter nav-items (ea-value :app :app/stack)))]
    [:div {:id "nav"}
     [:ul {:className "breadcrumb"}
      (each [item (cursors items :description)]
                [:li {:onClick (fn []
                                 (swap! (cursor :app :app/stack)
                                        (fn [cur-stack]
                                          (vec (take-while #(not= (.-entity item) %) cur-stack))))
                                 )}
                 @item])]
     ]))

;;*********************************************************
;; Notebooks
;;*********************************************************

(defn click-add-notebook [e]
  (let [nb (nodes/notebook "untitled notebook")]
    (swap! aurora-state datalog/batch (set (:facts nb)) #{})))

(defdom notebooks-list [knowledge]
    [:ul {:className "notebooks"}
     (each [nb (cursors (datalog/all knowledge :notebook) :description)]
           [:li {:onClick (fn []
                            (println "swapped: " (.-entity nb))
                            (reset! (cursor :app :app/stack) [(.-entity nb)])
                            )}
            @nb]
           )
     [:li {:className "add-notebook"
           :onClick click-add-notebook} "+"]])

;;*********************************************************
;; Pages
;;*********************************************************

(defn click-add-page [e notebook]
  (let [pg (nodes/page "untitled page")]
    (swap! aurora-state datalog/batch (set (:facts pg)) #{})
    (swap! (cursor notebook :notebook/pages) conj (:id pg))))

(defdom pages-list [knowledge]
  (let [[pages notebook] (q1 knowledge
                             [:nav :nav/notebook ?cur-notebook]
                             [?cur-notebook :notebook/pages ?pages]
                             :return [pages cur-notebook])]
    [:ul {:className "notebooks"}
     (each [pg (cursors pages :description)]
           [:li {:onClick (fn []
                            (swap! (cursor :app :app/stack) conj (.-entity pg))
                            )}
            @pg]
           )
     [:li {:className "add-notebook"
           :onClick #(click-add-page % notebook)} "+"]]))

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
    (condp = (ea-value :app :app/screen)
      :steps (steps-ui stack)
      :pages (pages-list stack)
      (notebooks-list stack))
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

(def r-nav-items (rule [:app :app/stack ?stack]
                       (:collect ?pages [[?id :page true]
                                        (:in ?id stack)
                                        :return
                                        id])
                       (:collect ?notebooks [[?idn :notebook true]
                                             (:in ?idn stack)
                                             :return
                                             idn])
                       :return
                       [:nav :nav/items (set/union pages notebooks)]))

(def r-nav-notebook (rule [:app :app/stack ?stack]
                          (:collect ?notebooks [[?idn :notebook true]
                                                (:in ?idn stack)
                                                :return
                                                idn])
                          :return
                          [:nav :nav/notebook (when notebooks
                                                (last (filter notebooks stack)))]))

(def r-nav-page (rule [:app :app/stack ?stack]
                      (:collect ?pages [[?idn :page true]
                                        (:in ?idn stack)
                                        :return
                                        idn])
                      :return
                      [:nav :nav/page (when pages
                                        (last (filter pages stack)))]))

(def data-rules
  [(rule [?e :data/nil _]
         :return
         [e :ui/rep [:span {:className "value"} "nil"]])
   (rule [?e :data/number ?number]
         :return
         [e :ui/rep [:span {:className "value"} (str number)]])
   (rule [?e :data/text ?text]
         :return
         [e :ui/rep [:span {:className "value"} (str text)]])
   (rule [?e :data/vector ?elems]
         (:collect ?values [(:in ?id elems)
                            [?id :ui/rep ?rep]
                            :return
                            [id rep]])

         (= (count elems) (count values))
         :return
         [e :ui/rep (let [reps (into {} values)]
                       [:ul {:className "vector"}
                        (for [e elems]
                          [:li (reps e)])])])
   (rule [?e :data/map ?kvs]
         (:collect ?ks [(:in ?id (keys kvs))
                          [?id :ui/rep ?rep]
                          :return
                          [id rep]])
         (:collect ?values [(:in ?id (vals kvs))
                            [?id :ui/rep ?rep]
                            :return
                            [id rep]])
         (= (count ks) (count kvs) (count values))
         :return
         [e :ui/rep
            (let [reps (into {} (concat values ks))]
              [:table {:className "map"}
               (for [[k v] (zipmap (map first ks) (map first values))]
                 [:tr
                  [:td.map-key (reps k)]
                  [:td.map-value (reps v)]])]
              )
          ])
   ])

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
    (try
      (js/React.renderComponent
       (aurora-ui knowledge)
       (js/document.getElementById "wrapper"))
      (catch :default e
        (.error js/console (or (.-stack e) e))
        ))
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
