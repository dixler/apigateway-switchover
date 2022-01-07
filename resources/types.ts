import * as awsx from "@pulumi/awsx";

export type IntegrationResponseT = {
    statusCode: number,
    headers: {[key: string]: string},
    body: string,
};

export type CallbackT<E> = (event: E) => Promise<IntegrationResponseT> | void

export type SupportedRouteT = awsx.apigateway.Route;

export interface RoutableResource {
    route: SupportedRouteT;
}