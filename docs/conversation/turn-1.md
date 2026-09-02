# Turn 1

## USER:

I need to source data to train a gru model to identify latent intent such as frustration and hesitation from ui microinteraction, specifically from such a microtensor. Where can I look and how do I find the right microinteraction dataset?

```typescript
export interface MicroTensor {
  meanVelocity: number; // px/ms
  maxVelocity: number; // px/ms
  meanAcceleration: number; // px/ms^2
  hesitationCount: number; // Direction shifts > 45 degrees
  totalTrajectoryLength: number; // Cumulative pixels
  dwellTimeMs: number; // Milliseconds over active components
  scrollDepthPercentage: number;
  scrollVelocity: number; // px/ms
  timestamp: number;
}
```

---

## ASSISTANT:

Yes. With the `MicroTensor` you showed, the dataset search becomes much more specific.

You are **not primarily looking for an emotion/text dataset**. You need **temporally ordered mouse/UI interaction data from which your exact features can be reconstructed**, ideally with a ground-truth label for the user's state.

Your tensor is essentially:

$$
X_t =
[v,\ v_{max},\ a,\ h,\ L,\ dwell,\ scrollDepth,\ scrollVelocity]
$$

and your GRU would learn:

$$
(X_{t-n},...,X_t) \rightarrow
P(\text{frustration}),P(\text{hesitation}),...
$$

## The most promising datasets I found

### 1. A dataset specifically about website interactions + emotions

This is the **closest match to your research problem**:

**“A dataset of interactions and emotions for website user experience evaluation”**, published in _Scientific Data_.

It contains mouse-interaction measurements including **mouse speed, acceleration, trajectory information**, and other interaction data, with associated emotional/user-experience information. ([Nature][1])

This is the first dataset I would investigate.

In particular, the paper's raw representation includes things such as:

- mouse speed X/Y
- mouse acceleration X/Y
- trajectory slope
- timestamps
- interaction events

That means you aren't starting with a dataset that merely says _"user was frustrated."_ You have the underlying movement data from which your MicroTensor can potentially be reconstructed. ([PubMed Central (PMC)][2])

**Why this is valuable:** it bridges the two things you need:

```text
raw UI interaction
        +
emotional/user-experience labels
        ↓
      training data
```

rather than trying to infer frustration from unrelated conversational text.

---

## 2. Search specifically for mouse-tracking + affect

There is a substantial HCI literature showing that mouse trajectories contain information about psychological/affective states.

The **Attentive Cursor Dataset** paper is particularly useful as a literature/data-source map. It discusses prior work connecting mouse movement characteristics with emotional states, including research relating cursor behaviour to **frustration, interest, confidence, excitement and arousal**. ([PubMed Central (PMC)][3])

That gives you an important search strategy:

Don't search only for:

> "frustration dataset"

Search for:

```text
mouse tracking affect
mouse trajectory emotion
cursor movement emotion
mouse dynamics cognitive load
mouse movement frustration
mouse trajectory frustration
mouse movement hesitation
cursor trajectory uncertainty
HCI motor behavior emotion
```

A lot of relevant datasets are hidden behind **HCI/affective-computing experiments**, rather than being published under "ML dataset" terminology.

---

# 3. There is a particularly interesting frustration experiment

I found research describing an experiment where researchers deliberately induced frustrating conditions and recorded mouse behaviour.

The collected variables included:

- cursor speed
- cursor distance
- trajectory
- pauses
- hesitation
- click timing
- trajectory irregularity

and participants' emotional states were assessed. ([ijahci.com][4])

Another experiment deliberately created a frustrated group and compared mouse movement behaviour against a non-frustrated group, with participants also reporting their emotional state. ([LSE Blogs][5])

This type of dataset is **far more valuable for your GRU than a generic mouse-dynamics dataset**, because the experimental manipulation gives you something approaching a causal label:

```text
             experimental condition
                    ↓
        ┌───────────┴───────────┐
        ↓                       ↓
   frustrating              non-frustrating
   condition                condition
        ↓                       ↓
       UI interaction sequences
        ↓                       ↓
              mouse features
                    ↓
                emotional
                  label
```

That's much closer to what you're trying to learn.

---

# 4. Don't discard "mouse dynamics" datasets

There are large datasets containing raw cursor trajectories even when they weren't collected for emotion research.

For example, the newly published **Mouse Dynamics Dataset for Behavioral User Substitution Detection in Electronic Testing** contains **31.99 million mouse events from 1,755 users**, including movement speed, movement length, direction and inter-event timing. ([Mendeley Data][6])

It doesn't provide the frustration labels you need, so **don't use it as your primary supervised dataset**.

But it could be useful for:

### Pretraining

```text
millions of raw trajectories
             ↓
          GRU/encoder
             ↓
     generic interaction
       representation
             ↓
        fine-tuning
             ↓
  frustration/hesitation
```

That's actually an interesting approach if your eventual dataset is small.

Other useful raw mouse datasets include:

- **SapiMouse** — 120 subjects with timestamp/button/state/x/y trajectories. ([GitHub][7])
- **Balabit Mouse Dynamics Challenge** — timing and positioning information from mouse pointers. ([GitHub][8])
- **AdSERP** — mouse movements on search-engine-result pages, with timestamps, coordinates, events and DOM/XPath information. ([GitHub][9])

These are useful primarily for **trajectory/microinteraction representation learning**, not directly for emotion classification.

---

# 5. Your `MicroTensor` changes how I'd approach the problem

There's an important architectural detail here.

Your tensor is already **aggregated**:

```typescript
export interface MicroTensor {
  meanVelocity: number;
  maxVelocity: number;
  meanAcceleration: number;
  hesitationCount: number;
  totalTrajectoryLength: number;
  dwellTimeMs: number;
  scrollDepthPercentage: number;
  scrollVelocity: number;
  timestamp: number;
}
```

So don't search exclusively for datasets that contain exactly these fields.

Instead, search for **raw interaction trajectories**.

You can derive most of your tensor.

For raw points:

```text
(t₀, x₀, y₀)
(t₁, x₁, y₁)
(t₂, x₂, y₂)
...
```

you can calculate:

```text
distance_i
velocity_i
acceleration_i
direction_i
direction_change_i
```

and then aggregate:

```text
meanVelocity
maxVelocity
meanAcceleration
totalTrajectoryLength
hesitationCount
```

Likewise:

```text
mousemove
scroll
mouseenter
mouseleave
click
```

can give you:

```text
dwellTime
scrollVelocity
scrollDepth
```

This dramatically expands the datasets you can use.

---

# 6. I would actually modify your MicroTensor slightly

There is one issue with the current representation:

```typescript
hesitationCount: number;
```

Your comment says:

> Direction shifts > 45 degrees

That is useful, but **direction reversal alone doesn't necessarily represent hesitation**.

For example:

```text
A → B → C → D
```

can contain large direction changes simply because the user is navigating around UI elements.

I'd add at least:

```typescript
pauseCount: number;
maxPauseDurationMs: number;
meanPauseDurationMs: number;
directionChangeCount: number;
backtrackDistance: number;
```

And potentially:

```typescript
clickCount: number;
repeatedClickCount: number;
errorInteractionCount: number;
```

Then your tensor becomes much more expressive:

```text
                  MicroTensor
                      │
       ┌──────────────┼──────────────┐
       │              │              │
     Motion        Hesitation      Interaction
       │              │              │
 velocity       pause duration    click rate
 acceleration   direction shifts  repetitions
 trajectory     backtracking      errors
       │              │              │
       └──────────────┼──────────────┘
                      ↓
                     GRU
                      ↓
          latent behavioural state
```

---

# 7. The dataset you ultimately want

If I were defining the target dataset for your project, I'd want something like:

```text
session_id
task_id
timestamp

mean_velocity
max_velocity
mean_acceleration
hesitation_count
total_trajectory_length
dwell_time_ms
scroll_depth_percentage
scroll_velocity

pause_count
max_pause_duration
backtrack_distance
click_count
error_count

task_completion
task_completion_time

frustration_score
hesitation_score
confidence_score
difficulty_score
```

Critically, the labels should be **time-aligned**, rather than merely:

```text
session → frustrated
```

Ideally:

```text
t0 ───── t1 ───── t2 ───── t3 ───── t4
 │        │        │        │        │
 ↓        ↓        ↓        ↓        ↓
neutral neutral  unsure  frustrated frustrated
```

That is what makes the **GRU particularly appropriate**.

---

# 8. How I'd search for the dataset

Use Google Scholar, ACM Digital Library, IEEE Xplore, Springer, Nature Scientific Data, Zenodo, OSF and GitHub.

Search combinations such as:

### Direct

```text
"mouse trajectory" frustration dataset
"mouse movement" frustration dataset
"cursor movement" frustration dataset
"mouse tracking" emotion dataset
"mouse tracking" affect dataset
```

### Hesitation

```text
"mouse trajectory" hesitation
"cursor movement" hesitation
"mouse movement" indecision
"mouse trajectory" uncertainty
"cursor trajectory" cognitive load
```

### UI / web

```text
"web interaction" mouse dataset emotion
"website interaction" mouse tracking emotion
"web usability" mouse trajectory dataset
"web navigation" mouse movement dataset
"website" "mouse tracking" frustration
```

### Dataset repositories

```text
site:zenodo.org mouse trajectory emotion
site:osf.io mouse tracking frustration
site:github.com mouse trajectory dataset emotion
site:huggingface.co mouse movement dataset
site:dataverse.org mouse tracking emotion
```

---

# 9. More importantly: evaluate datasets against a checklist

Don't choose a dataset merely because it says "mouse movements."

Give each candidate a score:

| Requirement                         |    Importance |
| ----------------------------------- | ------------: |
| Raw timestamped mouse coordinates   |  **Critical** |
| Multiple users                      |  **Critical** |
| Sequential interaction/session data |  **Critical** |
| Emotional/affective labels          |  **Critical** |
| Frustration labels                  | **Very high** |
| Task context                        | **Very high** |
| Click events                        |          High |
| Scroll events                       |          High |
| Element/DOM information             |          High |
| Dwell/hover information             |          High |
| Self-reported state                 | **Very high** |
| Experimental manipulation           | **Very high** |
| Enough sessions per user            |          High |

A dataset with:

> 10 million mouse movements but no psychological labels

is actually less immediately useful to you than:

> 50,000 trajectories from 100 participants with frustration ratings.

---

# 10. My recommended path for your project

I'd pursue **three data sources simultaneously**:

### A. Primary supervised dataset

Start with the **website interaction + emotion dataset** from _Scientific Data_. It appears unusually close to your problem because it contains mouse speed/acceleration/trajectory information alongside UX/emotional information. ([Nature][1])

### B. Secondary raw trajectory datasets

Use:

- AdSERP
- SapiMouse
- Balabit
- the large 2026 mouse dynamics dataset

for developing and testing your **raw → MicroTensor transformation pipeline** and potentially pretraining. ([Mendeley Data][6])

### C. Eventually collect your own labelled dataset

This is the part I would make the **actual research contribution**.

Have participants perform controlled UI tasks:

```text
Easy task
    ↓
Normal interaction

Difficult task
    ↓
Hesitation / uncertainty

Intentionally obstructed task
    ↓
Frustration
```

Then collect:

```text
raw interaction
       +
MicroTensor
       +
task outcome
       +
post-task self-report
```

You can then train:

```text
MicroTensor₁
MicroTensor₂
MicroTensor₃
      ...
MicroTensorₙ
      │
      ▼
     GRU
      │
      ├── frustration
      ├── hesitation
      ├── uncertainty
      └── engagement
```

That would give you a much stronger experimental story than simply downloading an existing emotion dataset.

**The key finding from the search is that your proposed MicroTensor is not speculative:** existing HCI research already uses mouse speed, acceleration, trajectory, pauses, dwell/hover behaviour and related movement characteristics to study attention, difficulty and emotional state. ([PubMed Central (PMC)][3])

For your project, I would therefore **search for raw trajectory + affect-labelled HCI datasets, not "GRU datasets."** The GRU is your modelling choice; the important property of the dataset is that it preserves the temporal interaction signal and has a defensible ground-truth label.

[1]: https://www.nature.com/articles/s41597-025-06079-1?utm_source=chatgpt.com "A dataset of interactions and emotions for website user experience evaluation | Scientific Data"
[2]: https://pmc.ncbi.nlm.nih.gov/articles/PMC12624104/?utm_source=chatgpt.com "A dataset of interactions and emotions for website user experience evaluation - PMC"
[3]: https://pmc.ncbi.nlm.nih.gov/articles/PMC7701271/?utm_source=chatgpt.com "The Attentive Cursor Dataset - PMC"
[4]: https://www.ijahci.com/index.php/ijahci/article/download/13/10/17?utm_source=chatgpt.com "Beyond Speed and Distance: Expanding Metrics for Detecting User Frustration in Human-Computer Interaction"
[5]: https://blogs.lse.ac.uk/businessreview/2016/10/27/negative-emotions-influence-how-we-move-the-computer-mouse/?utm_source=chatgpt.com "Negative emotions influence how we move the computer mouse - LSE Business Review"
[6]: https://data.mendeley.com/datasets/3rfsbcmgfw/1?utm_source=chatgpt.com "Mouse Dynamics Dataset for Behavioral User Substitution Detection in Electronic Testing - Mendeley Data"
[7]: https://github.com/margitantal68/sapimouse?utm_source=chatgpt.com "GitHub - margitantal68/sapimouse: SapiMouse - a new dataset for Mouse Dynamics · GitHub"
[8]: https://github.com/balabit/Mouse-Dynamics-Challenge?utm_source=chatgpt.com "GitHub - balabit/Mouse-Dynamics-Challenge · GitHub"
[9]: https://github.com/kayhan-latifzadeh/AdSERP?utm_source=chatgpt.com "GitHub - kayhan-latifzadeh/AdSERP: AdSERP: A Versatile Dataset of Mouse and Eye Movements on Search Engine Results Pages · GitHub"
