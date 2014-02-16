(ns aurora.datalog
  (:require clojure.set)
  (:require-macros [aurora.util :refer [check deftraced]]
                   [aurora.match :refer [match]]
                   [aurora.datalog :refer [rule defrule q* q? q!]]))

;; TODO naming is inconsistent

(defrecord Schema [attribute check-v! check-vs!])

(defrecord Knowledge [axiom-eavs cache-eavs e->a->vs a->e->vs a->schema rules])

(defn set-schema [knowledge schema]
  ;; TODO check schema
  (assoc-in knowledge [a->schema (:attribute schema)] schema))

(defn add-eav
  ([knowledge eav]
   (add-eav knowledge eav true))
  ([knowledge eav axiom?]
   (let [[e a v] eav
         {:keys [check-v! check-vs!]} (get-in knowledge [a->schema a])
         _ (when check-v! (check-v! v))
         vs (conj (get-in knowledge [:e->a->vs e a] #{}) v)
         _ (when check-vs! (check-vs! vs))
         knowledge (-> knowledge
                       (update-in [:cache-eavs] conj eav)
                       (assoc-in [:e->a->vs e a] vs)
                       (assoc-in [:a->e->vs a e] vs))]
     (if axiom?
       (update-in knowledge [:axiom-eavs] conj eav)
       knowledge))))

(defn- fixpoint [knowledge]
  (let [new-knowledge (reduce
                       (fn [knowledge rule]
                         (reduce #(add-eav %1 %2 false) knowledge (rule knowledge)))
                       knowledge
                       (:rules knowledge))]
    (if (not= knowledge new-knowledge)
      (recur new-knowledge)
      knowledge)))

(defn knowledge [facts rules]
  (fixpoint (reduce add-eav (Knowledge. #{} #{} {} {} {} rules) facts)))

(defn know [knowledge & facts]
  (fixpoint (reduce add-eav knowledge facts)))

(defn unknow [knowledge & facts]
  (let [new-facts (clojure.set/difference (:axiom-eavs knowledge) facts)]
    (fixpoint (reduce add-eav (Knowledge. #{} #{} {} {} {} (:rules knowledge)) facts))))

(comment

  ((rule
       [?x ?relates ?z]
       [?y ?relates ?z]
       (not= x y)
       :return
       [x :likes y]
       [y :likes x])
   (knowledge
    #{[:jamie :likes :datalog]
       [:jamie :likes :types]
       [:jamie :hates :types]
       [:chris :likes :datalog]
       [:chris :hates :types]}))

  ((rule
    [?x :likes ?z]
    [?y :hates ?z]
    (not= x y)
    :return
    [x :hates y])
   (knowledge
    #{[:jamie :likes :datalog]
      [:jamie :likes :types]
      [:jamie :hates :types]
      [:chris :likes :datalog]
      [:chris :hates :types]}))

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

  (:cache-eavs marmite)
  (:e->a->vs marmite)

  (q* marmite [:jamie ?relates :chris] :return relates)

  (q* (unknow marmite [:chris :hates :types]) [:jamie ?relates :chris] :return relates)

  (q* marmite [?entity ?relates :chris] :ignore (assert (keyword? relates)))

  (q* marmite [?entity ?relates :chris] :ignore (assert (= :impossible relates)))

  (q? marmite [:jamie ?relates :chris])

  (q? marmite [:jamie ?relates :bob])

  (q! marmite [:jamie ?relates :chris] :return relates)

  (q! marmite [:jamie ?relates :chris] :return relates relates)
  )
