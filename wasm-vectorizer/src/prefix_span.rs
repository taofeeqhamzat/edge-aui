use std::collections::HashMap;
use crate::types::PrefixSpanPattern;

/// Recursive PrefixSpan algorithm for mining sequential macro-interaction patterns.
pub fn mine_prefix_span(
    sequences: &[Vec<String>],
    min_support: usize,
) -> Vec<PrefixSpanPattern> {
    let mut patterns = Vec::new();
    let total_sequences = sequences.len();

    if total_sequences == 0 || min_support == 0 {
        return patterns;
    }

    let initial_projected: Vec<&[String]> = sequences.iter().map(|s| s.as_slice()).collect();
    mine_projected(&[], &initial_projected, min_support, total_sequences, &mut patterns);

    // Sort by pattern length descending, then support descending
    patterns.sort_by(|a, b| {
        b.pattern.len().cmp(&a.pattern.len())
            .then_with(|| b.support.cmp(&a.support))
    });

    patterns
}

fn mine_projected(
    prefix: &[String],
    projected_db: &[&[String]],
    min_support: usize,
    total_sequences: usize,
    patterns: &mut Vec<PrefixSpanPattern>,
) {
    // 1. Count frequencies of next item occurrences in the projected DB
    let mut item_counts: HashMap<&str, usize> = HashMap::new();

    for seq in projected_db {
        let mut seen_in_seq = std::collections::HashSet::new();
        for item in *seq {
            if seen_in_seq.insert(item.as_str()) {
                *item_counts.entry(item.as_str()).or_insert(0) += 1;
            }
        }
    }

    // 2. Iterate through items satisfying min_support
    for (item, &support) in &item_counts {
        if support >= min_support {
            let mut new_prefix = prefix.to_vec();
            new_prefix.push(item.to_string());

            let confidence = if total_sequences > 0 {
                (support as f64) / (total_sequences as f64)
            } else {
                0.0
            };

            patterns.push(PrefixSpanPattern {
                pattern: new_prefix.clone(),
                support,
                confidence: (confidence * 1000.0).round() / 1000.0,
            });

            // 3. Construct projected database for the new prefix
            let mut next_projected: Vec<&[String]> = Vec::new();
            for seq in projected_db {
                if let Some(pos) = seq.iter().position(|s| s.as_str() == *item) {
                    let suffix = &seq[pos + 1..];
                    if !suffix.is_empty() {
                        next_projected.push(suffix);
                    }
                }
            }

            if !next_projected.is_empty() {
                mine_projected(&new_prefix, &next_projected, min_support, total_sequences, patterns);
            }
        }
    }
}
