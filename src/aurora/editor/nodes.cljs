(ns aurora.editor.nodes
  (:require [aurora.compiler.compiler :refer [new-id]]))

;;*********************************************************
;; Aurora state (nodes)
;;*********************************************************

(defn notebook [desc]
  (let [id (new-id)]
    {:id id
     :facts
     [[id :notebook/pages []]
      [id :description desc]]}))

(defn page [desc]
  (let [id (new-id)]
    {:id id
     :facts
     [[id :page/steps []]
      [id :page/args []]
      [id :description desc]]}))

(defn scalar [x]
  (let [id (new-id)]
    {:id id
     :facts [[id
              (if (string? x)
                :data/text
                :data/number)
              x]]}))

(defn constant
  ([data] (constant data {}))
  ([data opts]
     (cond
      (:id data) data
      (map? data) (let [id (new-id)
                        ks (map constant (keys data))
                        vs (map constant (vals data))
                        id-map (zipmap (map :id ks) (map :id vs))]
                    {:id id
                     :facts (concat [[id :data/map id-map]]
                                    (mapcat :facts ks)
                                    (mapcat :facts vs))})
      (vector? data) (let [id (new-id)
                           vs (map constant data)
                           id-vec (mapv :id vs)]
                       {:id id
                        :facts (concat [[id :data/vector id-vec]]
                                       (mapcat :facts vs))})
      (keyword? data) {:id data
                       :facts []}
      :else (scalar data))))

(defn call
  ([ref args] (call ref args {}))
  ([ref args opts]
   (let [id (new-id)
         args-c (map constant args)]

     {:id id
      :facts (concat [[id :call/fun (:id ref)]
                      [id :call/args (mapv :id args-c)]]
                     (mapcat :facts args-c))})))

(defn math []
  (let [id (new-id)]
    {:id id
     :facts [id :math/expression [{:id "+"} 3 4]]}))

(defn match-branch [pattern action]
  {:type :match/branch
   :pattern (or pattern "foo")
   :guards []
   :action (or action {:type :constant
                       :data "wheeee"})})

(defn match-capture [id]
  {:type :match/bind :id id :pattern {:type :match/any}})

(defn match [arg pattern action]
  {:type :match
   :arg (or arg "foo")
   :branches [(match-branch pattern action)]})

(defn ref-id [id]
  {:id id})

(defn ref-js [js]
  {:id js})
