import axios from 'axios'
import chalk, { foregroundColorNames, ForegroundColorName } from 'chalk'
import delay from 'delay'
import * as dotenv from 'dotenv'
import { readFileSync } from 'fs'
import { join as pathJoin } from 'path'
import { parse as tomlParse } from 'toml'
import { xdgConfig } from 'xdg-basedir'

// check once every 30 seconds
const CHECK_PERIOD = 30_000

function requireEnv(keyName: string): string {
  const val = process.env[keyName]
  if (!val) throw new Error(`Must set environment variable ${keyName}`)
  return val
}

type Format = (text: string) => string

interface Bus {
  name: string
  minLines: number
}

interface BusStop {
  code: number
  format: Format
}

interface Config {
  stops: BusStop[]
  buses: Map<string, Bus>
  rows: number
  columns: number
}

function validateBuses(buses: any): asserts buses is Bus[] {
  if (!(buses instanceof Array)) throw new Error('Each bus stop should an array of buses')

  for (const bus of buses) {
    if (typeof bus.name !== 'string') throw new Error('Each bus should contain a name')
    if (typeof bus.minLines !== 'number')
      throw new Error('Each bus should contain a minLines entry')
  }
}

function buildConfig(config: any): Config {
  const { stops } = config
  if (!(stops instanceof Array)) {
    throw new Error('Config should contain stops array')
  }

  const { buses } = config
  validateBuses(buses)

  return {
    rows: config.rows,
    columns: config.columns,
    buses: new Map(buses.map((bus) => [bus.name, bus])),
    stops: stops.map((stop) => {
      const { code, color } = stop
      if (typeof code !== 'number') throw new Error('Each bus stop should contain a code number')
      if (typeof color !== 'string') throw new Error('Each bus stop should contain a color')

      const isHexColor = color.startsWith('#')
      if (!isHexColor && !foregroundColorNames.includes(color as ForegroundColorName)) {
        throw new Error(`Invalid color: ${color}`)
      }

      return {
        code,
        format: isHexColor
          ? chalk.hex(color)
          : (chalk as Record<ForegroundColorName, (text: string) => string>)[
              color as ForegroundColorName
            ],
      }
    }),
  }
}

interface Arrival {
  busStopCode: number
  serviceNumber: string
  // in seconds
  timeToArrival: number
  format: Format
}

function pushArrival(
  arrivals: Arrival[],
  format: Format,
  busStopCode: number,
  serviceNumber: string,
  data: any,
) {
  const estimatedArrival = data.EstimatedArrival
  if (estimatedArrival !== '') {
    const now = new Date()
    arrivals.push({
      busStopCode,
      serviceNumber,
      format,
      timeToArrival: Math.round((new Date(estimatedArrival).getTime() - now.getTime()) / 1000),
    })
  }
}

function formatTimeToArrival(timeToArrival: number) {
  const minutes = Math.floor(timeToArrival / 60)
  if (minutes === 0) {
    return `${timeToArrival}s`
  } else {
    return `${minutes}m ${timeToArrival - minutes * 60}s`
  }
}

const sortArrivals = (arrivals: Arrival[]): Arrival[] =>
  arrivals.sort((a, b) => a.timeToArrival - b.timeToArrival)

async function retrieveStop(apiKey: string, stopCode: number): Promise<any> {
  const response = await axios.get(
    `http://datamall2.mytransport.sg/ltaodataservice/BusArrivalv2?BusStopCode=${stopCode}`,
    { headers: { AccountKey: apiKey } },
  )
  return response.data
}

function enforceMinLinesConfig(config: Config, arrivals: Arrival[]): void {
  if (arrivals.length < config.rows) {
    return
  }

  const linesPerBus = new Map<string, number>()
  for (let i = 0; i < config.rows; ++i) {
    const { serviceNumber } = arrivals[i]
    linesPerBus.set(serviceNumber, (linesPerBus.get(serviceNumber) ?? 0) + 1)
  }

  for (let i = config.rows; i < arrivals.length; ++i) {
    const busConfig = config.buses.get(arrivals[i].serviceNumber)
    if (busConfig) {
      const { minLines } = busConfig
      const shownLines = linesPerBus.get(busConfig.name) ?? 0
      if (shownLines < minLines) {
        arrivals.unshift(arrivals.splice(i, 1)[0])
        --i
        linesPerBus.set(busConfig.name, shownLines + 1)
      }
    }
  }
}

async function showStops(apiKey: string, config: Config): Promise<void> {
  let arrivals: Arrival[] = []
  for (;;) {
    for (const stop of config.stops) {
      retrieveStop(apiKey, stop.code).then((data) => {
        const busStopCode = parseInt(data.BusStopCode)
        // console.log(JSON.stringify(data, null, 2))
        arrivals = arrivals.filter((arrival) => arrival.busStopCode !== busStopCode)
        for (const service of data.Services) {
          pushArrival(arrivals, stop.format, busStopCode, service.ServiceNo, service.NextBus)
          pushArrival(arrivals, stop.format, busStopCode, service.ServiceNo, service.NextBus2)
          pushArrival(arrivals, stop.format, busStopCode, service.ServiceNo, service.NextBus3)
        }

        arrivals = sortArrivals(arrivals)
        enforceMinLinesConfig(config, arrivals)

        const shownArrivals = sortArrivals(arrivals.slice(0, config.rows - 1))

        if (process.stdout.isTTY) {
          console.clear()
        } else {
          console.log()
        }

        for (const arrival of shownArrivals) {
          const formattedTimeToArrival = formatTimeToArrival(arrival.timeToArrival)
          const spaces = ' '.repeat(
            config.columns - arrival.serviceNumber.length - formattedTimeToArrival.length,
          )
          console.log(
            arrival.format(`${arrival.serviceNumber}${spaces}${formattedTimeToArrival}`),
          )
        }
      })
    }

    await delay(CHECK_PERIOD)
  }
}

async function main(): Promise<void> {
  dotenv.config()
  const apiKey = requireEnv('API_KEY')
  if (!xdgConfig) throw new Error('Could not find xdg data directory')
  // console.log('Showing bus stops %O with preferred buses %O')
  const tomlLocation = pathJoin(xdgConfig, 'starrybus.toml')
  const config = tomlParse(readFileSync(tomlLocation).toString())

  await showStops(apiKey, buildConfig(config))
}

main().catch(console.error)
