import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as awsx from "@pulumi/awsx";

import {CallbackT, RoutableResource} from "./types";


export class GKEStrategy<E> extends pulumi.ComponentResource implements RoutableResource {
    route: awsx.apigateway.Route;
    constructor(name: string, args: {callback: CallbackT<E>, route: awsx.apigateway.Route /* TODO make partial */}, opts?: {}) {
        super('xbow:gke:GKEStrategy', name, args, opts)

        // Create a GKE cluster
        const cluster = new gcp.container.Cluster(name, {
            project: 'pulumi-development', // TODO fix this
            location: "us-west1",
            initialNodeCount: 1,
        });

        // Export the Cluster name
        const clusterName = cluster.name;

        // Manufacture a GKE-style kubeconfig. Note that this is slightly "different"
        // because of the way GKE requires gcloud to be in the picture for cluster
        // authentication (rather than using the client cert/key directly).
        const kubeconfig = pulumi.
            all([ cluster.name, cluster.endpoint, cluster.masterAuth ]).
            apply(([ name, endpoint, masterAuth ]) => {
                const context = `${gcp.config.project}_${gcp.config.zone}_${name}`;
                return `apiVersion: v1
        clusters:
        - cluster:
            certificate-authority-data: ${masterAuth.clusterCaCertificate}
            server: https://${endpoint}
          name: ${context}
        contexts:
        - context:
            cluster: ${context}
            user: ${context}
          name: ${context}
        current-context: ${context}
        kind: Config
        preferences: {}
        users:
        - name: ${context}
          user:
            auth-provider:
              config:
                cmd-args: config config-helper --format=json
                cmd-path: gcloud
                expiry-key: '{.credential.token_expiry}'
                token-key: '{.credential.access_token}'
              name: gcp
        `;
            });

        // Create a Kubernetes provider instance that uses our cluster from above.
        const clusterProvider = new k8s.Provider(name, {
            kubeconfig: kubeconfig,
        });

        // Create a Kubernetes Namespace
        const ns = new k8s.core.v1.Namespace(name, {}, { provider: clusterProvider });

        // Export the Namespace name
        const namespaceName = ns.metadata.apply(m => m.name);

        const handlerName = "handler";
        const serializedFileNameNoExtension = "__index";

        const code = pulumi.runtime.serializeFunction(args.callback).then(v => v.text);
        
        const appLabels = { appClass: name };
        const deployment = new k8s.apps.v1.Deployment(name,
            {
                metadata: {
                    namespace: namespaceName,
                    labels: appLabels,
                },
                spec: {
                    replicas: 1,
                    selector: { matchLabels: appLabels },
                    template: {
                        metadata: {
                            labels: appLabels,
                        },
                        spec: {
                            containers: [
                                {
                                    name: name,
                                    image: "lukehoban/nodejsrunner",
                                    ports: [{ name: "http", containerPort: 8080 }],
                                    env: [{
                                        name: "PULUMI_SRC",
                                        value: code,
                                    }]
                                }
                            ],
                        }
                    }
                },
            },
            {
                provider: clusterProvider,
            }
        );

        // Export the Deployment name
        const deploymentName = deployment.metadata.apply(m => m.name);

        // Create a LoadBalancer Service for the NGINX Deployment
        const service = new k8s.core.v1.Service(name,
            {
                metadata: {
                    labels: appLabels,
                    namespace: namespaceName,
                },
                spec: {
                    type: "LoadBalancer",
                    ports: [{ port: 80, targetPort: "http" }],
                    selector: appLabels,
                },
            },
            {
                provider: clusterProvider,
            }
        );

        // Export the Service name and public LoadBalancer endpoint
        const serviceName = service.metadata.apply(m => m.name);
        const servicePublicIP = service.status.apply(s => s.loadBalancer.ingress[0].ip)
        
        this.route = {
            path: args.route.path,
            target: {
                uri: servicePublicIP,
                type: "http_proxy",
            }
        }
    }
}