type Employee = {
  firstName: string
  lastName: string
  workno: string
  department: string
  jobTitle: string
}

const KV_KEY = "employee_list"

export const getAll = async (kv: KVNamespace): Promise<Employee[]> => {
  const data = await kv.get(KV_KEY)
  return data ? (JSON.parse(data) as Employee[]) : []
}

export const sync = async (kv: KVNamespace, employees: Employee[]): Promise<number> => {
  const current = await getAll(kv)
  const byWorkno = new Map(current.map((e) => [e.workno, e]))

  for (const emp of employees) {
    byWorkno.set(emp.workno, emp)
  }

  const merged = [...byWorkno.values()]
  await kv.put(KV_KEY, JSON.stringify(merged))
  return merged.length
}

export type { Employee }
