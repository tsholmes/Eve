(ns aurora.datalog
  (:require clojure.set)
  (:require-macros [aurora.datalog :refer [rule defrule q* q? q!]]))

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
  ((rule
       [?x ?relates ?z]
       [?y ?relates ?z]
       (not= x y)
       :return
       [x :likes y]
       [y :likes x])
   #{[:jamie :likes :datalog]
       [:jamie :likes :types]
       [:jamie :hates :types]
       [:chris :likes :datalog]
       [:chris :hates :types]})

  (def marmite
    (knowledge
     #{[:jamie :likes :datalog]
       [:jamie :likes :types]
       [:jamie :hates :types]
       [:chris :likes :datalog]
       [:chris :hates :types]}
     [(rule
       [?x ?relates ?z]
       [?y ?relates ?z]
       (not= x y)
       :return
       [x :likes y]
       [y :likes x])
      (rule
       [?x :likes ?z]
       [?y :hates ?z]
       (not= x y)
       :return
       [x :hates y])
      (rule
       [?x :likes ?y]
       [?x :hates ?y]
       (not= x y)
       :return
       [x :marmites y])]
     []))

  (:facts marmite)

  (q* marmite [:jamie ?relates :chris] :return relates)

  (q* (unknow marmite [:chris :hates :types]) [:jamie ?relates :chris] :return relates)

  (q* marmite [?entity ?relates :chris] :ignore (assert (keyword? relates)))

  (q* marmite [?entity ?relates :chris] :ignore (assert (= :impossible relates)))

  (q? marmite [:jamie ?relates :chris])

  (q? marmite [:jamie ?relates :bob])

  (q! marmite [:jamie ?relates :chris] :return relates)

  (q! marmite [:jamie ?relates :chris] :return relates relates)
  )
