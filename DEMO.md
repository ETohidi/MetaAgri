# MetaAgri demo (5 minutes)

MetaAgri is a digital twin of a small arable farm in the Oderbruch and its two neighbours,
which you can zoom through at five levels: Earth, Germany, the Oderbruch, a farm and one of
its fields. Everything runs in the browser. The farms, fields, weather and numbers are
simulated, and the farm names are fictional.

## Start

Open https://etohidi.github.io/MetaAgri/, or run it locally:

```bash
cd web && npm run serve
```

Then open http://127.0.0.1:8090. The season always starts the same way (seed 20260707):
Monday 6 July, with the first plan already waiting for the farm manager. Every number below
is what that seed shows; **Restart season** replays it.

Names you'll see: the **North, West and River field agents** propose each field's work, the
**Coordinator** bundles their proposals into one plan, the **Safety check** blocks anything
that breaks a hard rule, the **Machinery ring** lines up help from the neighbour farms,
**Farm** is the twin itself, and the **Farm manager** is you.

## Choreography

1. **Zoom in.** Start on Earth and click Germany, then Brandenburg (or the Oderbruch pin).
   On the Oderbruch map each farm is a pin sized by its area and coloured by its soil
   moisture and silo fill. The dashed lines carry what each neighbour told the Machinery
   ring it can share today: Gut Rohrdommelsee "can share 1 combine · 470 t", Agrarhof
   Oderblick "can share 0 combines · 130 t" (its combine is busy). Our three fields sit in
   the "Our fields" inset. Click **Hof Lerchenbruch**, the farm we run.

### Act 1: a normal day

2. **Read the farm.** Today is 25 °C and dry; tomorrow brings 7.5 mm of rain. The flower has
   one petal per field, coloured by soil moisture against the crop's stress line: North 48%,
   West 44%, River 62% (amber, close to the potatoes' 60% stress line). On the right is the
   **Plan for Mon 6 Jul**: West "Scout field" (0.70, "rapeseed ripening, 3 days to harvest;
   checking seed moisture.") and River "Irrigate 25 mm · 6,000 m³ water · 1 worker" (0.80,
   "Soil moisture 62%; forecast 10.3 mm crop water use vs 7.5 mm rain over 2 days (heading
   for ~59%, stress below 60%)."). The resource cards read Water 6,500 → 500 m³ and Workers
   5 → 4. Click **Approve plan**. A drop falls on the River petal, River goes to 87%, and
   **What buyers & neighbours see** gets "Irrigation running on River field today (25 mm) —
   the field track may be wet."

### Act 2: heatwave

3. **Heatwave.** Click **Heatwave** in the top bar. A red banner reads "Heatwave: water
   permit cut to 3,600 m³/day" with "4 days left", today turns 34 °C, and the water-permit
   card turns red ("Cut from 6,500 m³").

4. **Next day.** The **Plan for Tue 7 Jul** ("3 proposals, 2/3 actions cleared by the safety
   check"). River is at 79% but asks for 25 mm again, because the heat will dry it to ~62%
   in two days; 6,000 m³ is more than the 3,600 m³ permit, so the card shows **Safety check
   blocked: River field: Irrigate 25 mm. Irrigation must stay within today's water permit.**
   The flower's stem grows a red thorn. North and West only scout. Pick **Wait for better
   weather** and click **Reject plan**. The Team conversation reads "Farm manager: rejected
   the Tue 7 Jul plan: Wait for better weather".

5. **Next day.** In the **Plan for Wed 8 Jul** River asks for **Irrigate 15 mm · 3,600 m³**,
   which fits the cut permit. Its note says why: "irrigating 15 mm (3,600 m³), fitted to
   today's 3,600 m³ water permit. (Noting recent rejection: Wait for better weather)". The
   heat has also ripened the wheat and the rapeseed twice as fast, so both want the combine
   today; that is Act 3's story, and a hail warning tells it better.

   *Side trip:* if you press **Heatwave** while a plan built before it is still waiting,
   **Approve plan** is refused in the plan card: "This plan no longer passes the safety
   check: irrigate for River field: Irrigation must stay within today's water permit. Reject
   it so the field agents re-plan."

### Act 3: hail warning

6. **Restart season**, then **Approve plan**: the same Monday and the same plan as step 2.

7. **Hail warning.** An amber banner reads "Hail warning: severe hail expected Wed 8 Jul.
   Harvest ripe crops before it hits." The Wed 8 Jul weather card turns red (24.0 mm rain,
   13.7 m/s wind, "Hail storm"), Tue 7 Jul is made dry and calm, and the North and West
   petals get a red dashed outline: both crops are now due tomorrow.

8. **Next day.** The **Plan for Tue 7 Jul** ("4 proposals, 3/3 actions cleared by the safety
   check", overall confidence 0.50). Both crops want the one combine, and the Coordinator
   keeps the field with the most value at risk: "conflict: the combine was requested by
   North field and West field; kept North field (€71k at risk vs €52k), West field waits".
   The Machinery ring fills the gap:
   - North · Harvest ~324 t · combine · 2 workers · 0.85 · "Hail expected Wed 8 Jul;
     harvesting ripe wheat now."
   - West · Harvest with Gut Rohrdommelsee's combine (~114 t) · 0.50
   - West · Deliver 108 t to Gut Rohrdommelsee · 0.50 · "~438 t coming in today but only
     330 t free in our silo; Gut Rohrdommelsee reports 228 t spare storage."

   **Neighbour help** shows each farm's answer: Gut Rohrdommelsee can share 1 combine and
   228 t, Agrarhof Oderblick 0 combines and 53 t. The resource cards read Workers 5 → 2,
   Combine 1 → 0, Silo free 330 → 0 t. Open the **Oderbruch** level now: the line to Gut
   Rohrdommelsee carries a green flow (the borrowed combine) and an amber one (the
   delivery). Back on the farm, click **Approve plan**. Grain flies into the silo and one
   load leaves for the neighbour; our silo is full (450 of 450 t) and Hof Lerchenbruch turns
   Critical; Gut Rohrdommelsee's free silo space drops from 507 to 399 t. Four notices go
   out: the wheat (~324 t, confidence high) and rapeseed (~114 t, medium) harvests to
   Buyers, and to Gut Rohrdommelsee "thanks for lending your combine for our West field
   (rapeseed) today." and "expect about 108 t of rapeseed for storage today."

9. **Next day.** The hail hits Wed 8 Jul: "Hail hit River field: potato leaves shredded,
   crop health down 0.08" (River 0.90 → 0.83). North and West are safe in the silo; their
   agents wait: "Wheat stubble too wet after 24.0 mm rain; drilling the cover crop once the
   soil dries." Approve, then **Next day** (Thu 9 Jul, 3.3 mm): both sow a cover crop.
   Approve, and the neighbours hear "Cover crop sown on North field after the wheat harvest."

   *What if you had rejected step 8's plan* with **A neighbour farm should help with this**?
   The storm takes 40% of both crops: "Hail hit North field: winter wheat lost 40%" (324 →
   193 t) and West 114 → 67 t, and both agents wait: "wheat ripe but 24.0 mm rain today -
   too wet to harvest." The reason also adds a hint to the field agents' census that the
   Machinery ring can line up a neighbour's combine.

10. **Drill into a field.** Click a petal or a field on the farm map. The field page shows
    soil moisture day by day with a dashed 3-day projection, the stress line, rain and
    irrigation bars, the crop right now, the last plans for this field, and **What the field
    agent sees**: the exact census its agent reads before proposing.

11. **Visit a neighbour.** Use the zoom ladder to go back to the Oderbruch and open Gut
    Rohrdommelsee: its silo space and soil moisture since Monday, and the last reports its
    agent gave the Machinery ring.

**Play** advances the season by itself (1×, 2× or 4×). It holds while you're typing a
rejection reason. A plan nobody decides on expires when the next day's plan arrives.

## What this demonstrates

- **Five levels, one twin.** The same simulated state at every scale: the region on Earth,
  the connected region in Germany, every farm's silo, combine and soil in the Oderbruch,
  every field on the farm, every day of one field.
- **Agents propose, a person decides.** Field agents propose each day's work, the
  Coordinator bundles it into one plan with before/after resources, and nothing changes
  until the farm manager approves.
- **Safety check.** Deterministic rules screen every action before a person sees it: the
  water permit, spray weather and the pre-harvest interval, dry-day harvests, one field per
  machine per day, workers, and neighbour capacity. Blocked actions stay visible with the
  rule, and an approval is re-checked against the farm as it is now.
- **Human feedback.** A rejection reason goes back to the field agents and changes what they
  propose next.
- **Neighbouring farms.** Every farm's agent reports what it can share each day, and the
  Machinery ring borrows a combine or sends surplus grain to a neighbour with room.
- **Buyers and neighbours only hear about approved work.**
