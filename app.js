// Public event data only.
// Džiugas can edit this list without touching the page layout.
// When real dates, prices and registration URLs exist, replace the placeholders below.

const events = [
  {
    state: "PLANUOJAMA · 2026 SPALIS",
    title: "Astra Academy: atviras įvadinis seminaras",
    description: "Trumpas online susitikimas apie Astra principą, pirmus praktinius formatus ir kam ši bendruomenė skirta.",
    place: "Online",
    price: "Nemokamai"
  },
  {
    state: "PLANUOJAMA · 2026 SPALIS",
    title: "Sekmadienio žygis + praktinis užsiėmimas",
    description: "Pirmas gyvas 3–5 val. prototipas: judėjimas, užduotis, praktinis įgūdis ir aptarimas.",
    place: "Vilnius / apylinkės",
    price: "Kaina bus paskelbta"
  },
  {
    state: "PLANUOJAMA · 2026 SPALIS",
    title: "Strategija asmeniniame gyvenime",
    description: "Gyvas seminaras apie prioritetus, pasirinkimų kainą ir strateginį mąstymą už profesinės aplinkos ribų.",
    place: "Vilnius",
    price: "Kaina bus paskelbta"
  }
];

const eventList = document.querySelector("#event-list");

if (eventList) {
  eventList.innerHTML = events.map(event => `
    <article class="event-card">
      <p class="event-state">${event.state}</p>
      <h3>${event.title}</h3>
      <p>${event.description}</p>
      <div class="event-meta">
        <span>${event.place}</span>
        <span>${event.price}</span>
      </div>
    </article>
  `).join("");
}

const year = document.querySelector("#year");
if (year) year.textContent = new Date().getFullYear();
