# LiveKit shared webhook (UniWork guest)

Webhook URL to add (keep existing lms-core URL):

http://uniwork-be.uniwork.svc.cluster.local:8080/api/v1/integrations/livekit/webhook

LiveKit `webhook` has one api_key and a list of urls. Edit secret
`reap-integrations/livekit-server-config` key `livekit.yaml` on bastion
(do not commit the rendered YAML). Rolling restart `deploy/livekit` after.

Discover tunnel CIDR:

```bash
kubectl get node -l workload=livekit \
  -o jsonpath='{.items[0].metadata.annotations.projectcalico\.org/IPv4IPIPTunnelAddr}{"\n"}'
```

Apply NetPol with that /32 if different from `10.244.217.192` (update the manifest CIDR first):

```bash
kubectl apply -f deploy/livekit/allow-hostnetwork-uniwork-webhook.yaml
```
