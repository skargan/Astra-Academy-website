// Džiugas: edit this list to update the event cards.
// Keep state as "Data netrukus" until a date is confirmed.
// registrationUrl: leave empty for an email enquiry, or add the real https:// booking URL.
const events = [
  {
    state: "Data netrukus",
    title: "Susipažink su Astra",
    description: "Atviras susitikimas internetu. Sužinok apie žygius ir užsiėmimus, susipažink su bendruomene ir užduok savo klausimus.",
    place: "Internetu",
    price: "Nemokamai",
    registrationUrl: ""
  },
  {
    state: "Data netrukus",
    title: "Sekmadienio žygis",
    description: "3–5 valandos gamtoje: žygis, praktinė užduotis ir bendras aptarimas. Prisijunk vienas arba su draugu.",
    place: "Vilnius / apylinkės",
    price: "Kaina netrukus",
    registrationUrl: ""
  },
  {
    state: "Data netrukus",
    title: "Strategija kasdienybėje",
    description: "Kaip pasirinkti, kam skirti savo laiką ir jėgas? Seminaras apie prioritetus, sprendimų pasekmes ir veiksmų planą.",
    place: "Vilnius",
    price: "Kaina netrukus",
    registrationUrl: ""
  }
];

const eventList = document.querySelector("#event-list");
if (eventList) {
  events.forEach(event => {
    const card = document.createElement("article");
    card.className = "event-card";
    const add = (tag, text, className) => {
      const element = document.createElement(tag);
      element.textContent = text;
      if (className) element.className = className;
      card.append(element);
      return element;
    };
    add("p", event.state, "event-state");
    add("h3", event.title);
    add("p", event.description);
    const meta = add("div", "", "event-meta");
    [event.place, event.price].forEach(text => {
      const item = document.createElement("span");
      item.textContent = text;
      meta.append(item);
    });
    let bookingUrl;
    try {
      const url = new URL(event.registrationUrl);
      if (url.protocol === "https:") bookingUrl = url.href;
    } catch { /* An empty URL uses the email enquiry below. */ }
    const action = add("a", bookingUrl ? "Registruotis ↗" : "Domina šis renginys ↗", "button secondary event-action");
    action.href = bookingUrl || "mailto:info@astra-academy.net?subject=" + encodeURIComponent("Astra — " + event.title);
    action.setAttribute("aria-label", (bookingUrl ? "Registruotis: " : "Pasiteirauti: ") + event.title);
    eventList.append(card);
  });
}
const year = document.querySelector("#year");
if (year) year.textContent = new Date().getFullYear();
