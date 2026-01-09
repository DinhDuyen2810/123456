import { useEffect } from 'react'
import { test5, test6, test7, test8 } from '../tests/debugTests'

export default function Dashboard() {
  useEffect(() => {
    async function run() {
      await test5()
      await test6()
      await test7()
      await test8()
    }

    run().catch(console.error)
  }, [])

  return <div>Crypto Debug Dashboard</div>
}
