// Logic for different domains
const tools = {
    "network.ping": async (router, host) => await router.menu('/ping').call({ address: host, count: '4' }),
    "network.resource": async (router) => await router.menu('/system/resource').get(),
    "hotspot.addUser": async (router, name, profile) => {
        return await router.menu('/ip/hotspot/user').add({ name, password: name, profile });
    },
    "hotspot.active": async (router) => await router.menu('/ip/hotspot/active').get(),
};

module.exports = tools;