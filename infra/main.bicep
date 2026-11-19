targetScope = 'resourceGroup'

@description('Globally unique logical SQL server name for a new dedicated DEV/TEST database.')
@minLength(3)
@maxLength(63)
param serverName string

param location string = resourceGroup().location
param databaseName string = 'shopstream'

@description('Entra administrator object ID, never the web runtime identity.')
param administratorObjectId string
param administratorName string
@allowed(['User', 'Group', 'Application'])
param administratorType string = 'User'

@description('Explicit approved client/egress IPv4 addresses. Empty leaves the public firewall closed. Never use 0.0.0.0.')
param allowedClientIpAddresses array = []

@minValue(60)
@maxValue(10080)
param autoPauseDelayMinutes int = 60

resource server 'Microsoft.Sql/servers@2023-08-01' = {
  name: serverName
  location: location
  tags: { purpose: 'shopstream-azuresql-devtest' }
  properties: {
    version: '12.0'
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    administrators: {
      administratorType: 'ActiveDirectory'
      principalType: administratorType
      login: administratorName
      sid: administratorObjectId
      tenantId: subscription().tenantId
      azureADOnlyAuthentication: true
    }
  }
}

resource database 'Microsoft.Sql/servers/databases@2023-08-01' = {
  parent: server
  name: databaseName
  location: location
  sku: {
    name: 'GP_S_Gen5'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: 2
  }
  properties: {
    minCapacity: json('0.5')
    autoPauseDelay: autoPauseDelayMinutes
    maxSizeBytes: 2147483648
    collation: 'SQL_Latin1_General_CP1_CI_AS'
    zoneRedundant: false
    requestedBackupStorageRedundancy: 'Local'
  }
}

resource firewallRules 'Microsoft.Sql/servers/firewallRules@2023-08-01' = [for (address, index) in allowedClientIpAddresses: {
  parent: server
  name: 'approved-client-${index}'
  properties: {
    startIpAddress: address
    endIpAddress: address
  }
}]

output serverId string = server.id
output databaseId string = database.id
output host string = server.properties.fullyQualifiedDomainName
output database string = database.name
