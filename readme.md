# starrybus

A home display for Singapore bus timings.

## instructions

Run with `API_KEY` environment variable set and create a config file at `$HOME/.config/starrybus.toml` something like:

```toml
buses = [
  # always show at least two entries for 123 when possible even if they would
  # otherwise be cut from the end of the display
  { name = "123", minLines = 2 },
  { name = "456", minLines = 1 },
]

[[stops]]
code = 1234
color = "blue"

[[stops]]
code = 4567
color = "red"
```

Bus stop codes can be read from [this map](https://www.lta.gov.sg/content/ltagov/en/map/bus.html).
