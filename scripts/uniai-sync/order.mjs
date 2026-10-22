export function orderIssues(issues) {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const cycles = new Set();
  const done = new Set();

  function walk(id, stack) {
    if (!byId.has(id) || done.has(id)) return;
    const at = stack.indexOf(id);
    if (at !== -1) {
      for (const item of stack.slice(at)) cycles.add(item);
      return;
    }
    stack.push(id);
    const parent = byId.get(id).parent_issue_id;
    if (parent) walk(parent, stack);
    stack.pop();
    done.add(id);
  }

  for (const issue of issues) walk(issue.id, []);

  const indegree = new Map();
  const children = new Map();
  for (const issue of issues) {
    if (cycles.has(issue.id)) continue;
    indegree.set(issue.id, 0);
    children.set(issue.id, []);
  }
  for (const issue of issues) {
    if (cycles.has(issue.id)) continue;
    const parent = issue.parent_issue_id;
    if (parent && indegree.has(parent)) {
      indegree.set(issue.id, indegree.get(issue.id) + 1);
      children.get(parent).push(issue.id);
    }
  }
  const queue = [...indegree.keys()].filter((id) => indegree.get(id) === 0);
  const order = [];
  while (queue.length > 0) {
    const id = queue.shift();
    order.push(id);
    for (const child of children.get(id)) {
      indegree.set(child, indegree.get(child) - 1);
      if (indegree.get(child) === 0) queue.push(child);
    }
  }
  return { order, cycles: [...cycles] };
}
