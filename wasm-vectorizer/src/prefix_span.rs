//! PrefixSpan sequential pattern mining.
//!
//! ## What was wrong (Quality Assessment 2, F-02)
//!
//! The previous implementation was correct about *which* pattern set it enumerated, but it
//! had no bound on what it produced and no stable output order:
//!
//! 1. **Unbounded.** There was no maximum pattern length and no maximum pattern count, so
//!    the pattern set grew combinatorially with repeated symbols. A probe on a corpus of
//!    three short sequences returned 1 163 patterns; nine 18-symbol sequences returned
//!    2 452. The Fast Gate sorted that set on every window, and the corpus was the whole
//!    session history, so the cost grew with the session.
//! 2. **Non-deterministic order.** Items were iterated out of a `HashMap`, whose iteration
//!    order is randomised per map in Rust. Five repeated calls with the same corpus and the
//!    same support threshold produced five different orderings. A caller that truncates the
//!    result therefore kept a different subset on each call.
//! 3. **Confidence was global coverage.** `support / corpus_size` is the fraction of *all*
//!    sessions that contain the pattern. A declared pattern's strength is the probability
//!    that the pattern's last symbol follows its prefix, so it must be `support / prefix
//!    support`.
//!
//! ## What this implementation does
//!
//! It is standard PrefixSpan with an earliest-occurrence projection, which is complete for
//! subsequence support: if a sequence contains the prefix followed by an item, it contains
//! that prefix followed by the item's earliest such occurrence, and the suffix after the
//! earliest occurrence is a superset of the suffix after any later one. Each sequence
//! therefore contributes at most one projection entry per depth, so memory is bounded by
//! `sequences × max_pattern_length` and not by the number of occurrences.
//!
//! Support counts *sequences*, not occurrences, because a pattern is a session-level
//! property. Confidence is the conditional probability `support(pattern) / support(prefix)`,
//! so a length-1 pattern keeps the corpus-coverage meaning and a longer pattern reports its
//! strength as a continuation.
//!
//! Ordering is deterministic at every step: candidate items are ranked by support
//! descending then symbol ascending before the pattern budget is spent, and the returned
//! vector is sorted by length descending, support descending, then lexicographically. The
//! same corpus and bounds always produce the same vector.

use std::collections::{BTreeMap, HashSet};

use crate::types::PrefixSpanPattern;

/// Hard bounds on one mining call. `max_pattern_length` and `max_patterns` are the
/// bounded-execution contract the Fast Gate relies on; `min_support` prunes the search.
#[derive(Debug, Clone, Copy)]
pub struct MineBounds {
    pub min_support: usize,
    pub max_pattern_length: usize,
    pub max_patterns: usize,
}

/// One sequence's remaining suffix, tagged with the sequence it came from so support can be
/// counted per sequence rather than per occurrence.
struct Projected<'a> {
    seq_id: usize,
    suffix: &'a [String],
}

/// Mines frequent sequential patterns under explicit bounds.
///
/// Returns an empty vector when there is nothing to mine (`min_support == 0`,
/// `max_patterns == 0`, no sequences, or only empty sequences).
pub fn mine_prefix_span(
    sequences: &[Vec<String>],
    min_support: usize,
    max_pattern_length: usize,
    max_patterns: usize,
) -> Vec<PrefixSpanPattern> {
    if sequences.is_empty() || min_support == 0 || max_patterns == 0 {
        return Vec::new();
    }

    let bounds = MineBounds {
        min_support,
        // A zero-length pattern does not exist; refuse to mine rather than emit nothing
        // silently for one level.
        max_pattern_length: max_pattern_length.max(1),
        max_patterns,
    };

    let projected: Vec<Projected<'_>> = sequences
        .iter()
        .enumerate()
        .filter(|(_, sequence)| !sequence.is_empty())
        .map(|(seq_id, sequence)| Projected {
            seq_id,
            suffix: sequence.as_slice(),
        })
        .collect();

    if projected.is_empty() {
        return Vec::new();
    }

    let mut patterns = Vec::new();
    let mut prefix = Vec::new();
    mine_projected(&mut prefix, &projected, sequences.len(), bounds, &mut patterns);

    patterns.sort_by(|a, b| {
        b.pattern
            .len()
            .cmp(&a.pattern.len())
            .then_with(|| b.support.cmp(&a.support))
            .then_with(|| a.pattern.cmp(&b.pattern))
    });

    patterns
}

fn mine_projected<'a>(
    prefix: &mut Vec<String>,
    projected: &[Projected<'a>],
    parent_support: usize,
    bounds: MineBounds,
    patterns: &mut Vec<PrefixSpanPattern>,
) {
    if prefix.len() >= bounds.max_pattern_length || patterns.len() >= bounds.max_patterns {
        return;
    }

    // Support per candidate item: distinct sequence ids, because support is a session
    // count. `BTreeMap` keeps the iteration order stable across runs.
    let mut supports: BTreeMap<&'a str, HashSet<usize>> = BTreeMap::new();
    for entry in projected {
        for item in entry.suffix {
            supports.entry(item.as_str()).or_default().insert(entry.seq_id);
        }
    }

    // Spend the pattern budget on the strongest continuations first, then on symbol order so
    // a tie is resolved the same way on every run.
    let mut ranked: Vec<(&'a str, usize)> = supports
        .iter()
        .map(|(item, seq_ids)| (*item, seq_ids.len()))
        .collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));

    for (item, support) in ranked {
        if support < bounds.min_support {
            continue;
        }
        if patterns.len() >= bounds.max_patterns {
            break;
        }

        prefix.push(item.to_string());
        let confidence = if parent_support == 0 {
            0.0
        } else {
            support as f64 / parent_support as f64
        };
        patterns.push(PrefixSpanPattern {
            pattern: prefix.clone(),
            support,
            confidence: round_to_three_decimals(confidence),
        });

        let mut next: Vec<Projected<'a>> = Vec::with_capacity(projected.len());
        for entry in projected {
            if let Some(position) = entry.suffix.iter().position(|symbol| symbol == item) {
                let rest = &entry.suffix[position + 1..];
                if !rest.is_empty() {
                    next.push(Projected {
                        seq_id: entry.seq_id,
                        suffix: rest,
                    });
                }
            }
        }

        if !next.is_empty() {
            mine_projected(prefix, &next, support, bounds, patterns);
        }
        prefix.pop();
    }
}

fn round_to_three_decimals(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seqs(values: &[&[&str]]) -> Vec<Vec<String>> {
        values
            .iter()
            .map(|sequence| sequence.iter().map(|symbol| symbol.to_string()).collect())
            .collect()
    }

    fn keys(patterns: &[PrefixSpanPattern]) -> Vec<String> {
        patterns
            .iter()
            .map(|pattern| pattern.pattern.join(">"))
            .collect()
    }

    fn support_of(patterns: &[PrefixSpanPattern], key: &str) -> Option<usize> {
        patterns
            .iter()
            .find(|pattern| pattern.pattern.join(">") == key)
            .map(|pattern| pattern.support)
    }

    #[test]
    fn empty_corpus_and_zero_bounds_return_nothing() {
        assert!(mine_prefix_span(&[], 1, 4, 32).is_empty());
        assert!(mine_prefix_span(&seqs(&[&["A"]]), 0, 4, 32).is_empty());
        assert!(mine_prefix_span(&seqs(&[&["A"]]), 1, 4, 0).is_empty());
    }

    #[test]
    fn single_sequence_enumerates_its_frequent_subsequences() {
        let patterns = mine_prefix_span(&seqs(&[&["A", "B", "C"]]), 1, 4, 32);
        let mut actual = keys(&patterns);
        actual.sort();
        assert_eq!(
            actual,
            vec!["A", "A>B", "A>B>C", "A>C", "B", "B>C", "C"]
        );
    }

    #[test]
    fn support_counts_sequences_not_occurrences() {
        // "A" occurs four times but in two sequences.
        let patterns = mine_prefix_span(&seqs(&[&["A", "A"], &["A"]]), 1, 4, 32);
        assert_eq!(support_of(&patterns, "A"), Some(2));
    }

    #[test]
    fn repeated_symbols_produce_nested_patterns() {
        let patterns = mine_prefix_span(&seqs(&[&["A", "A", "A"]]), 1, 4, 32);
        assert_eq!(
            keys(&patterns),
            vec!["A>A>A", "A>A", "A"]
        );
    }

    #[test]
    fn overlapping_occurrences_count_once_per_sequence_and_lose_nothing() {
        // `A` occurs at 0 and 2. Support is a session count, so `A>A` is support 1, not 2.
        // The later occurrence still yields `A>C`, because the suffix after the earliest
        // `A` contains both `A` and `C`.
        let patterns = mine_prefix_span(&seqs(&[&["A", "X", "A", "C"]]), 1, 4, 32);
        assert_eq!(support_of(&patterns, "A>A"), Some(1));
        assert_eq!(support_of(&patterns, "A>C"), Some(1));
        assert_eq!(support_of(&patterns, "X>C"), Some(1));
    }

    #[test]
    fn min_support_prunes() {
        let corpus = seqs(&[&["A", "B"], &["A", "C"], &["D"]]);
        let patterns = mine_prefix_span(&corpus, 2, 4, 32);
        assert_eq!(support_of(&patterns, "A"), Some(2));
        assert_eq!(support_of(&patterns, "A>B"), None);
        assert_eq!(support_of(&patterns, "D"), None);
    }

    #[test]
    fn confidence_is_conditional_on_the_prefix() {
        let corpus = seqs(&[&["A", "B"], &["A", "C"], &["B", "C"], &["A", "B", "C"]]);
        let patterns = mine_prefix_span(&corpus, 1, 4, 32);
        let a = patterns
            .iter()
            .find(|pattern| pattern.pattern.join(">") == "A")
            .expect("A");
        // Length-1 confidence is corpus coverage: 3 of 4 sequences contain A.
        assert!((a.confidence - 0.75).abs() < 1e-9);
        let ab = patterns
            .iter()
            .find(|pattern| pattern.pattern.join(">") == "A>B")
            .expect("A>B");
        // Two of the three sequences that contain A also continue with B.
        assert!((ab.confidence - (2.0 / 3.0)).abs() < 1e-3);
    }

    #[test]
    fn max_pattern_length_is_a_hard_bound() {
        let patterns = mine_prefix_span(&seqs(&[&["A", "B", "C", "D", "E"]]), 1, 2, 999);
        assert!(patterns.iter().all(|pattern| pattern.pattern.len() <= 2));
    }

    #[test]
    fn max_patterns_is_a_hard_bound() {
        let corpus = seqs(&[&["A", "B", "C", "D", "E", "F"]]);
        assert_eq!(mine_prefix_span(&corpus, 1, 6, 5).len(), 5);
        assert_eq!(mine_prefix_span(&corpus, 1, 6, 0).len(), 0);
    }

    #[test]
    fn output_is_identical_across_repeated_runs() {
        let corpus = seqs(&[
            &["A", "B", "C", "A", "B"],
            &["B", "A", "C"],
            &["C", "A", "B", "D"],
        ]);
        let first = keys(&mine_prefix_span(&corpus, 1, 4, 32));
        for _ in 0..20 {
            assert_eq!(first, keys(&mine_prefix_span(&corpus, 1, 4, 32)));
        }
    }

    #[test]
    fn budget_is_spent_on_the_strongest_patterns_first() {
        // "B" occurs in both sequences, "A" only in one. With a budget of one pattern the
        // stronger symbol is the one returned, on every run.
        let corpus = seqs(&[&["A", "B", "B"], &["B"]]);
        let patterns = mine_prefix_span(&corpus, 1, 4, 1);
        assert_eq!(keys(&patterns), vec!["B"]);
    }
}
