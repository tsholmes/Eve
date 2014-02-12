(ns aurora.datalog
  (:require clojure.set)
  (:require-macros [aurora.datalog :refer [rule defrule query]]))

(defrecord Knowledge [axioms facts rules])

(defn- fixpoint [knowledge]
  (let [rules (:rules knowledge)]
    (loop [facts (:facts knowledge)]
      (let [new-facts (reduce
                       (fn [facts rule]
                         (clojure.set/union (rule facts) facts))
                       facts
                       rules)]
        (if (not= facts new-facts)
          (recur new-facts)
          (assoc knowledge :facts new-facts))))))

(defn knowledge [facts rules guards]
  (fixpoint (Knowledge. facts facts rules)))

(defn know [knowledge & facts]
  (fixpoint (-> knowledge
                (update-in [:axioms] clojure.set/union facts)
                (update-in [:facts] clojure.set/union facts))))

(defn unknow [knowledge & facts]
  (let [new-facts (clojure.set/difference (:facts knowledge) facts)]
    (fixpoint (-> knowledge
                  (assoc-in [:axioms] new-facts)
                  (update-in [:facts] new-facts)))))

(comment
  (def marmite
    (knowledge
     #{[:jamie :likes :datalog]
       [:jamie :likes :types]
       [:jamie :hates :types]
       [:chris :likes :datalog]
       [:chris :hates :types]}
     [(rule
       [x :likes y]
       [y :likes x]
       :where
       [?x ?relates ?z]
       [?y ?relates ?z]
       (not= x y))
      (rule
       [x :hates y]
       :where
       [?x :likes ?z]
       [?y :hates ?z]
       (not= x y))
      (rule
       [x :marmites y]
       :where
       [?x :likes ?y]
       [?x :hates ?y]
       (not= x y))]
     []))

  (:facts marmite)

  (query marmite relates :where [:jamie ?relates :chris])

  (query (unknow marmite [:chris :hates :types]) relates :where [:jamie ?relates :chris])

  (query marmite :where [?entity ?relates :chris] :check (keyword? relates))

  (query marmite :where [?entity ?relates :chris] :check (= :impossible relates))
  )
