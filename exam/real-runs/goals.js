// Real, read-only goals on public websites. Each run starts on `url` and Show Me works
// from there. Goals are instructions, not questions, so each run uses the next-action
// and done-check tasks (a question would go to the locate task instead).
// No more than 8 runs per site.

export const GOALS = [
  // Wikipedia: find a fact
  { id: 'wiki-everest', url: 'https://en.wikipedia.org/wiki/Main_Page', goal: 'Find the height of Mount Everest on Wikipedia' },
  { id: 'wiki-lagos', url: 'https://en.wikipedia.org/wiki/Main_Page', goal: 'Find the population of Lagos on Wikipedia' },
  { id: 'wiki-turing', url: 'https://en.wikipedia.org/wiki/Main_Page', goal: 'Open the Wikipedia article on Alan Turing and find his date of birth' },
  { id: 'wiki-thames', url: 'https://en.wikipedia.org/wiki/Main_Page', goal: 'Find the length of the River Thames' },
  { id: 'wiki-python', url: 'https://en.wikipedia.org/wiki/Main_Page', goal: 'Find out who created the Python programming language' },
  { id: 'wiki-eiffel', url: 'https://en.wikipedia.org/wiki/Main_Page', goal: 'Find the year the Eiffel Tower was completed' },
  { id: 'wiki-jupiter', url: 'https://en.wikipedia.org/wiki/Main_Page', goal: 'Find how many moons Jupiter has, on its Wikipedia page' },
  { id: 'wiki-random', url: 'https://en.wikipedia.org/wiki/Main_Page', goal: "Open today's featured article" },

  // GitHub: open a repo's latest release
  { id: 'gh-node', url: 'https://github.com/nodejs/node', goal: "Open the Node.js repository's latest release" },
  { id: 'gh-playwright', url: 'https://github.com/microsoft/playwright', goal: 'Open the latest Playwright release notes' },
  { id: 'gh-vscode', url: 'https://github.com/microsoft/vscode', goal: "Find the VS Code repository's latest release" },
  { id: 'gh-react', url: 'https://github.com/facebook/react', goal: 'Open the latest release of React on GitHub' },
  { id: 'gh-deno-issues', url: 'https://github.com/denoland/deno', goal: 'Open the list of open issues in the Deno repository' },
  { id: 'gh-rust-license', url: 'https://github.com/rust-lang/rust', goal: "Open the Rust repository's licence file" },

  // Weather and time
  { id: 'bbc-weather-london', url: 'https://www.bbc.co.uk/weather', goal: 'Show the weather forecast for London' },
  { id: 'bbc-weather-cardiff', url: 'https://www.bbc.co.uk/weather', goal: 'Show the weather forecast for Cardiff' },
  { id: 'bbc-weather-edinburgh', url: 'https://www.bbc.co.uk/weather', goal: 'Show the weather forecast for Edinburgh' },
  { id: 'nws-seattle', url: 'https://www.weather.gov/', goal: 'Show the weather forecast for Seattle, WA' },
  { id: 'tad-tokyo', url: 'https://www.timeanddate.com/worldclock/', goal: 'Find the current time in Tokyo' },
  { id: 'tad-sunrise', url: 'https://www.timeanddate.com/sun/', goal: 'Find the sunrise time in London today' },

  // Trains and travel
  { id: 'tfl-status', url: 'https://tfl.gov.uk/', goal: 'Find the current status of the Victoria line' },
  { id: 'tfl-elizabeth', url: 'https://tfl.gov.uk/', goal: 'Find the status of the Elizabeth line' },
  { id: 'rtt-paddington', url: 'https://www.realtimetrains.co.uk/', goal: 'Show the next departures from London Paddington' },
  { id: 'rtt-manchester', url: 'https://www.realtimetrains.co.uk/', goal: 'Show the next departures from Manchester Piccadilly' },

  // Recipes
  { id: 'bbcgf-pancakes', url: 'https://www.bbcgoodfood.com/', goal: 'Find a recipe for pancakes' },
  { id: 'bbcgf-curry', url: 'https://www.bbcgoodfood.com/', goal: 'Find a recipe for chicken curry' },
  { id: 'bbcgf-jollof', url: 'https://www.bbcgoodfood.com/', goal: 'Find a recipe for jollof rice' },
  { id: 'bbcgf-brownies', url: 'https://www.bbcgoodfood.com/', goal: 'Find a recipe for chocolate brownies' },

  // Products and prices (read the price; never add to basket)
  { id: 'pihut-pi5', url: 'https://thepihut.com/', goal: 'Search for the Raspberry Pi 5 and read its price' },
  { id: 'pihut-pico', url: 'https://thepihut.com/', goal: 'Find the price of a Raspberry Pi Pico' },
  { id: 'books-travel', url: 'https://books.toscrape.com/', goal: 'Open the Travel category and read the price of the first book' },
  { id: 'books-poetry', url: 'https://books.toscrape.com/', goal: 'Find the price of a book in the Poetry category' },
  { id: 'apple-macbook', url: 'https://www.apple.com/uk/', goal: 'Find the starting price of the MacBook Air' },
  { id: 'apple-ipad', url: 'https://www.apple.com/uk/', goal: 'Find the starting price of the iPad' },

  // Opening hours
  { id: 'bm-hours', url: 'https://www.britishmuseum.org/', goal: 'Find the British Museum opening hours' },
  { id: 'nhm-hours', url: 'https://www.nhm.ac.uk/', goal: 'Find the Natural History Museum opening times' },
  { id: 'kew-hours', url: 'https://www.kew.org/', goal: 'Find the opening times for Kew Gardens' },
  { id: 'sm-hours', url: 'https://www.sciencemuseum.org.uk/', goal: 'Find the Science Museum opening hours' },

  // GOV.UK and other public information
  { id: 'gov-holidays', url: 'https://www.gov.uk/', goal: 'Find the date of the next bank holiday in England' },
  { id: 'gov-minwage', url: 'https://www.gov.uk/', goal: 'Find the current National Minimum Wage rates' },
  { id: 'gov-passport', url: 'https://www.gov.uk/', goal: 'Find how much it costs to renew an adult passport' },
  { id: 'gov-clocks', url: 'https://www.gov.uk/', goal: 'Find when the clocks change' },

  // Docs and package pages
  { id: 'mdn-fetch', url: 'https://developer.mozilla.org/en-US/', goal: 'Open the MDN reference page for the fetch() function' },
  { id: 'mdn-flexbox', url: 'https://developer.mozilla.org/en-US/', goal: 'Find the MDN guide to CSS flexbox' },
  { id: 'python-latest', url: 'https://www.python.org/', goal: 'Find the latest Python release version' },
  { id: 'node-lts', url: 'https://nodejs.org/en', goal: 'Find the current Node.js LTS version' },
  { id: 'pypi-requests', url: 'https://pypi.org/', goal: 'Find the latest version of the requests package' },
  { id: 'rust-install', url: 'https://www.rust-lang.org/', goal: 'Open the page that shows how to install Rust' },

  // News and reading
  { id: 'hn-top', url: 'https://news.ycombinator.com/', goal: 'Open the comments of the top story on Hacker News' },
  { id: 'hn-ask', url: 'https://news.ycombinator.com/', goal: 'Open the Ask HN page' },
  { id: 'ol-orwell', url: 'https://openlibrary.org/', goal: 'Find the book Nineteen Eighty-Four by George Orwell' },
  { id: 'ol-achebe', url: 'https://openlibrary.org/', goal: 'Find books by Chinua Achebe' },
];
