/*
** Copyright 2025 Metaversal Corporation.
** 
** Licensed under the Apache License, Version 2.0 (the "License"); 
** you may not use this file except in compliance with the License. 
** You may obtain a copy of the License at 
** 
**    https://www.apache.org/licenses/LICENSE-2.0
** 
** Unless required by applicable law or agreed to in writing, software 
** distributed under the License is distributed on an "AS IS" BASIS, 
** WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. 
** See the License for the specific language governing permissions and 
** limitations under the License.
** 
** SPDX-License-Identifier: Apache-2.0
*/

class MVClient extends MV.MVMF.NOTIFICATION
{
   #m_pFabric;
   #m_pLnG;

   #pRMXRoot;
   #wClass_Root
   #twObjectIx_Root;

   static eSTATE =
   {
      NOTREADY : 0,
      LOADING  : 1,
      READY    : 4
   };

   eSTATE = MVClient.eSTATE;

   constructor (sUrl)
   {
      super ();

      this.#pRMXRoot          = null;
      // All Map Services must have this RMRoot Object (wClass "70", twObjectIx "1")
      this.#wClass_Root       = 70;  
      this.#twObjectIx_Root   = 1;

      this.#m_pFabric = new MV.MVRP.MSF (sUrl, MV.MVRP.MSF.eMETHOD.GET);
      this.#m_pFabric.Attach (this);
   }

   destructor ()
   {
      if (this.#m_pLnG)
      {
         if (this.#pRMXRoot)
         {
            this.#m_pLnG.Model_Close (this.#pRMXRoot);
         }

         this.#m_pLnG.Detach (this);
         this.#m_pLnG = null;
      }

      if (this.#m_pFabric)
      {
         this.#m_pFabric.Detach (this);
         this.#m_pFabric.destructor ();

         this.#m_pFabric = null;
      }
   }

   onInserted (pNotice)
   {
      if (this.ReadyState () == this.eSTATE.READY)
      {
         if (pNotice.pData.pChild != null)
         {
            if (pNotice.pData.pChild.sID == 'RMPObject')
            {
               // Insert this object to my list (pNotice.pData.pChild)
            }
         }
      }
   }

   onUpdated (pNotice)
   {
      if (this.IsReady ())
      {
         if (pNotice.pData.pChild == null)
         {
         }
      }
   }

   onChanged (pNotice)
   {
      this.onUpdated (pNotice);
   }

   onDeleting (pNotice)
   {
      if (this.IsReady ())
      {
         let pChild = pNotice.pData.pChild;

         if (pChild)
         {
         }
      }
   }

   onReadyState (pNotice)
   {
      if (this.IsReady () == false)
      {
         if (pNotice.pCreator == this.#m_pFabric)
         {
            if (this.#m_pFabric.IsReady ())
            {
               console.log ('Fabric Loaded, Connecting to Metaverse Server...');
               
               this.#m_pLnG = this.#m_pFabric.GetLnG ("map");
               this.#m_pLnG.Attach (this);
            }
            else if (this.#m_pFabric.ReadyState () == this.#m_pFabric.eSTATE.ERROR)
            {
               console.log ('Error Loading Fabric File.');
            }
         }
         else if (pNotice.pCreator == this.#m_pLnG)
         {
            switch (this.#m_pLnG.ReadyState ())
            {
            case this.#m_pLnG.eSTATE.DISCONNECTED:    // Final State
               console.log ('Disconnected from Fabric Server.');
               break;

            case this.#m_pLnG.eSTATE.CONNECTING:      // Transitional State
               console.log ('Connecting to Fabric Server.'); 
               break;

            case this.#m_pLnG.eSTATE.LOGGING:         // Transitional State
               console.log ('Login Attempt into Fabric Server.');
               break;

            case this.#m_pLnG.eSTATE.LOGGEDIN:        // Final State
               console.log ('Connected as Authenticated User with Fabric Server.');

               this.Start ();
               break;

            case this.#m_pLnG.eSTATE.LOGGEDOUT:       // Final State
               console.log ('Connected as Anonymous User with Fabric Server.');

               if (1)       // If you application requires User Authentication (i.e. Map Editor)
               {
                  if (this.bLoginAttempt)
                  {
                     console.log ('ERROR: Failed to Login');
                  }
                  else
                  {
                     setTimeout (this.Login.bind (this, 'password'), 1);
                     console.log ('Prompting User Login.');
                  }
               }
               else         // Your application does NOT require User Authentication
               {
                  this.Start ();
               }
               break;
            }
         }
         else if (pNotice.pCreator.IsReady ())
         {
            if (this.ReadyState () == this.eSTATE.NOTREADY)
            {
               let pRMXObject = pNotice.pCreator;

               if (pRMXObject.wClass_Object == 70) // RMRoot
               {
                  if (pRMXObject.nChildren > 0)
                  {
                     console.log ('Start Loading Children...');

                     // Enum Children
                     //pRMXObject.Child_Enum ('RMPObject', this, this.EnumRoot, mpPObject);

                     this.ReadyState (this.eSTATE.LOADING); // Loading Children
                  }
                  else
                  {
                     console.log ('System Initialized')
                     this.ReadyState (this.eSTATE.READY);   // No Scenes
                  }
               }
            }
            else if (this.ReadyState () == this.eSTATE.LOADING)
            {
               console.log ('Loading Children...');

               if (1) // If Loading complete
               {
                  console.log ('System Initialized')
                  this.ReadyState (this.eSTATE.READY);
               }
            }
         }
      }
      else if (pNotice.pCreator.IsReady ())
      {
         console.log ('Subscribed Model Ready... (' + pNotice.pCreator.wClass_Object + '/' + pNotice.pCreator.twObjectIx + ')');
      }
   }

   Login (sKey)
   {
      this.bLoginAttempt = true;
      this.#m_pLnG.Login ('token=' + MV.MVMF.Escape (sKey));
   }

   GetClassID (wClass)
   {
      const ClassIds =
      {
         70: 'RMRoot',
         71: 'RMCObject',
         72: 'RMTObject',
         73: 'RMPObject',
      }

      return ClassIds[wClass];
   }

   Start ()
   {
      this.#pRMXRoot = this.#m_pLnG.Model_Open (this.GetClassID (this.#wClass_Root), this.#twObjectIx_Root);
      this.#pRMXRoot.Attach (this);
   }

   _sendAction (pIAction) 
   {
      return new Promise ((resolve, reject) => {
      pIAction.Send 
      (
         this, 
         function (pIAction) 
         {
            resolve (pIAction.pResponse);
         }
      );
    });
  }

   Search (pRMXObject)
   {
      let pIAction = pRMXObject.Request ('SEARCH');

      if (pIAction)
      {
         let Payload = pIAction.pRequest;

         if (pRMXObject.sID == 'RMCObject')
            Payload.twRMCObjectIx   = pRMXObject.twObjectIx;
         else Payload.twRMTObjectIx = pRMXObject.twObjectIx;

         pIAction.pRequest.dX = 0;
         pIAction.pRequest.dY = 0;
         pIAction.pRequest.dZ = 0;
         pIAction.pRequest.sText = searchText.toLowerCase();

         const pResponse = await this._sendAction(pIAction);

         if (pResponse.nResult == 0)
         {
            // Success
            //pResponse.aResultSet[0][0]
         }
         else
         {
            // ERROR: Look at error code.
         }
      }
   }

   IsReady ()
   {
      return (this.ReadyState () == this.eSTATE.READY);
   }

   EnumItem (pRMXObject, Param)
   {
      Param.push (pRMXObject);
   }
};
